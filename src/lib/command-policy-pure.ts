// Terminal command policy: what one shell command CORE (or the owner, from OPERATIONS → Terminal) asks to run may do.
//   Level 1, runs now: read/inspect, builds, tests, local renders, git status/diff/log, git commit on a branch that isn't main.
//   Level 2, runs after a snapshot, with Undo: commands that change files in his connected project folders.
//   Level 3, waits for his click every time: deletes, installs, system folders/registry/boot/services, network uploads,
//     logins/credentials, sending/publishing/payments, anything touching VAULT/journal/LIFE, and anything not understood here.
// Parsing is deliberately conservative: chaining (; && || &), sub-shells, variables, escapes, encoded or nested commands are level 3.
// Pure, client-safe; tests/command-policy.test.ts. Runtime: shell-session.ts.
import { PRIVATE_KINDS } from "./private-pure.ts";
import type { PcLevel } from "./pc-policy-pure.ts";

export type Shell = "powershell" | "cmd" | "bash";
export type Level = PcLevel; // the same three levels as JARVIS PC control (pc-policy-pure): 1 now, 2 snapshot + Undo, 3 his OK
export type CmdCtx = {
  shell: Shell;
  /** the session's working folder (absolute) */
  cwd: string;
  /** his connected project folders (absolute): reads and writes stay inside them */
  folders: readonly string[];
  /** VAULT / journal / LIFE / ORBIT data folders: anything touching them is level 3 and its output never goes to a model */
  privatePaths: readonly string[];
  /** home folder, for ~ */
  home?: string;
  /** git branch checked out in cwd ("" = unknown), for git commit */
  branch?: string;
  /** outside text (pages, files, agent results) is in CORE's context: level 2 needs his click too */
  outside?: boolean;
};
/** writes: absolute (normalized) paths it changes; "*" = anything under its connected folder (a script or a tool we can't scope). */
export type CmdVerdict = { level: Level; what: string; reason: string; writes: string[]; private: boolean };

const MAX_LEN = 2000;

/* ---------- paths ---------- */

/** Windows-or-POSIX absolute path → lowercase, forward slashes, "." and ".." resolved; null when it isn't absolute.
 *  Not pc-policy-pure normPath: that one refuses ".." outright (JARVIS gets whole paths); shell arguments like ../x must resolve against cwd. */
export function normPath(p: string): string | null {
  let s = p.trim().replace(/\\/g, "/");
  if (!s || s.length > 1000 || s.includes("\0")) return null;
  let root: string;
  if (/^[a-z]:(\/|$)/i.test(s)) { root = s.slice(0, 2).toLowerCase(); s = s.slice(2); }
  else if (s.startsWith("//")) return null; // UNC / network share
  else if (s.startsWith("/")) root = "";
  else return null;
  const out: string[] = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { out.pop(); continue; }
    out.push(part.toLowerCase());
  }
  return `${root}/${out.join("/")}`.replace(/(.)\/$/, "$1");
}
const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith("/") ? root : root + "/");
/** Resolve a command argument against cwd (and ~). null = not resolvable (network path, bad cwd). */
export function resolveArg(arg: string, cwd: string, home?: string): string | null {
  let a = arg.trim();
  if (/^~(?=$|[\\/])/.test(a)) { if (!home) return null; a = home + a.slice(1); }
  if (/^[a-z]:(?![\\/])/i.test(a) && a.length > 2) return null; // C:foo (drive-relative) is too odd to judge
  if (/^[\\/]{2}/.test(a)) return null;
  if (/^(?:[a-z]:)?[\\/]/i.test(a)) return normPath(a);
  return normPath(`${cwd}/${a}`);
}

type Where = "folder" | "private" | "system" | "outside" | "unknown";
const SYSTEM = /^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata|recovery|boot|\$recycle\.bin|system volume information)(?:\/|$)|[a-z]:\/?$|\/$|\/(?:etc|bin|sbin|usr|lib|lib64|boot|sys|proc|dev|var|opt|root|srv|run|snap)(?:\/|$))/;
const SECRET_SEG = /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.kaggle|\.docker|\.kube|\.git-credentials|\.netrc|_netrc|\.npmrc|\.pypirc|\.yarnrc|\.gitconfig|\.env(?:\.(?!example$|sample$|template$)[\w.-]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|known_hosts|authorized_keys|credentials(?:\.json)?|kaggle\.json|token\.json|youtube-oauth\.json|secrets?(?:\.[\w]+)?|.*\.(?:pem|key|pfx|p12|kdbx|keychain)|cookies(?:\.\w+)?|login data)$/;
// folder/file names that look like his private data (private-pure kinds + VAULT + Estonian "päevik"), wherever they are
const PRIVATE_SEG = new RegExp(`^(?:${PRIVATE_KINDS.join("|")}|journals|diaries|päevik|life\\.json|vault)(?:\\.\\w+)?$`);

/** Where an absolute path lies. Private beats a connected folder unless the folder is the more specific match (ORBIT's workspaces
 *  folder inside its private data folder); a folder inside nothing private wins over "outside". */
export function where(p: string, ctx: Pick<CmdCtx, "folders" | "privatePaths">): Where {
  if (SYSTEM.test(p)) return "system";
  const best = (roots: readonly string[]) => Math.max(-1, ...roots.map(normPath).filter((r): r is string => !!r && r !== "/" && under(p, r)).map((r) => r.length));
  const priv = best(ctx.privatePaths), fold = best(ctx.folders);
  if (priv >= 0 && priv >= fold) return "private";
  if (ctx.privatePaths.some((r) => { const n = normPath(r); return !!n && under(n, p) && n !== p; }) && fold < 0) return "private"; // a parent of private data (listing/searching it would show it)
  return fold >= 0 ? "folder" : "outside";
}
/** Connected folders that can be used: absolute, not a system folder or drive root, and not holding private data (a folder that
 *  contains VAULT/journal/LIFE, like the home folder, would let any search or script reach it). At most 20. */
export function usableFolders(folders: readonly string[], privatePaths: readonly string[]): string[] {
  const priv = privatePaths.map(normPath).filter((x): x is string => !!x);
  return [...new Set(folders.map((f) => f.trim()).filter((f) => {
    const n = normPath(f);
    return !!n && !SYSTEM.test(n) && !SYSTEM.test(n + "/") && !priv.some((pp) => under(pp, n) && pp !== n);
  }))].slice(0, 20);
}
const secretName = (p: string) => p.split("/").some((seg) => SECRET_SEG.test(seg));
const privateName = (p: string, cwd: string) => { const rel = p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p; return rel.split("/").some((seg) => PRIVATE_SEG.test(seg)); };

/* ---------- tokenizer ---------- */

type Tok = { t: string; quoted: boolean };
type Seg = { words: Tok[]; redirOut: string[]; redirIn: string[] };
type Parsed = { pipes: Seg[] } | { bad: string };

const BAD = (bad: string): Parsed => ({ bad });

/** One command line → pipeline segments, or why it can't be judged. Rejects anything that hides or chains a command. */
export function parse(cmd: string, shell: Shell): Parsed {
  if (!cmd.trim()) return BAD("empty command");
  if (cmd.length > MAX_LEN) return BAD("the command is too long to check");
  if (/[\r\n]/.test(cmd)) return BAD("several lines (more than one command)");
  if (/[\0-\x08\x0b-\x1f\x7f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/.test(cmd)) return BAD("hidden control characters");
  const segs: Seg[] = [];
  let words: Tok[] = [], redirOut: string[] = [], redirIn: string[] = [];
  let cur = "", quoted = false, inTok = false, pending: "out" | "in" | null = null;
  const push = () => {
    if (!inTok) return;
    if (pending === "out") redirOut.push(cur); else if (pending === "in") redirIn.push(cur); else words.push({ t: cur, quoted });
    cur = ""; quoted = false; inTok = false; pending = null;
  };
  const esc = shell === "powershell" ? "`" : shell === "cmd" ? "^" : "\\";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i], n = cmd[i + 1] ?? "";
    // things that hide or compute part of the command
    if (shell === "bash" && (c === "`" || (c === "$" && /[({\w@*#?$!-]/.test(n)))) return BAD("a sub-command or variable");
    if (shell === "bash" && c === "\\" ) return BAD("escape characters");
    if (shell === "powershell" && (c === "`")) return BAD("escape characters");
    if (shell === "powershell" && c === "$") return BAD("a variable or sub-expression");
    if (shell === "powershell" && (c === "{" || c === "}" || (c === "@" && (n === "(" || n === "{" || n === '"' || n === "'")) || (c === "[" && /[a-z]/i.test(n) && !inTok))) return BAD("a script block or .NET call");
    if (shell === "cmd" && (c === "%" || c === "^" || c === "!")) return BAD("a variable or escape character");
    if (c === '"' || c === "'") {
      if (c === "'" && shell === "cmd") { cur += c; inTok = true; continue; }
      const end = cmd.indexOf(c, i + 1);
      if (end < 0) return BAD("an unclosed quote");
      const body = cmd.slice(i + 1, end);
      if (c === '"' && (shell !== "cmd" ? /[$`]/.test(body) : /[%^!]/.test(body))) return BAD("a variable inside quotes");
      if (shell === "bash" && c === '"' && body.includes("\\")) return BAD("escape characters");
      if (shell === "powershell" && c === "'" && body.includes("'")) return BAD("an odd quote"); // can't happen, kept for clarity
      cur += body; inTok = true; quoted = true; i = end; continue;
    }
    if (c === esc && shell !== "bash") return BAD("escape characters");
    if (c === " " || c === "\t") { push(); continue; }
    if (c === ";" || (c === "&" && n === "&") || (c === "|" && n === "|")) return BAD("several commands chained together");
    if (c === "&") {
      if (shell === "powershell" && !inTok && words.length === 0 && segs.length === 0 && (n === " " || n === '"' || n === "'" || n === ".")) { push(); words.push({ t: "&", quoted: false }); continue; } // call operator: & .\venv\Scripts\Activate.ps1
      if (/^\d?>$/.test(cur) || cmd[i - 1] === ">") { cur += c; inTok = true; continue; } // 2>&1
      return BAD(shell === "bash" ? "a background or chained command" : "several commands chained together");
    }
    if (c === "(" || c === ")") return BAD(shell === "bash" ? "a sub-shell" : "a sub-expression");
    if (c === "|") {
      push();
      if (pending) return BAD("a broken redirection");
      if (!words.length) return BAD("an empty pipe stage");
      segs.push({ words, redirOut, redirIn }); words = []; redirOut = []; redirIn = []; continue;
    }
    if (c === "<") {
      if (n === "<" || n === "(") return BAD("a here-document or process substitution");
      push(); pending = "in"; continue;
    }
    if (c === ">") {
      // 2>&1, 2>nul, >/dev/null, >$null-free forms; *>, 2>, >>
      const prev = inTok && /^[12*]$/.test(cur) ? cur : null;
      if (prev !== null) { cur = ""; inTok = false; }
      else push();
      if (n === "(") return BAD("process substitution");
      let j = i + 1;
      if (cmd[j] === ">") j++;
      if (cmd[j] === "&") { // 2>&1 / >&2
        const m = /^&[12]/.exec(cmd.slice(j));
        if (!m) return BAD("an odd redirection");
        i = j + 1; continue;
      }
      i = j - 1; pending = "out"; continue;
    }
    cur += c; inTok = true;
  }
  if (pending && !inTok) return BAD("a redirection with no file");
  push();
  if (!words.length) return BAD(segs.length ? "an empty pipe stage" : "empty command");
  segs.push({ words, redirOut, redirIn });
  return { pipes: segs };
}

/* ---------- classification ---------- */

type Out = { level: Level; what: string; reason: string; writes: string[]; private?: boolean };
const L1 = (what: string): Out => ({ level: 1, what, reason: "only reads, builds or tests", writes: [] });
const L2 = (what: string, writes: string[] = ["*"]): Out => ({ level: 2, what, reason: "changes files in your project folder", writes });
const L3 = (what: string, reason: string): Out => ({ level: 3, what, reason, writes: [] });

const base = (w: string) => w.replace(/\\/g, "/").split("/").pop()!.toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, "");
const isFlag = (t: Tok, shell: Shell) => !t.quoted && (t.t.startsWith("-") || (shell !== "bash" && /^\/[a-z?][a-z0-9-]*(?::\S*)?$/i.test(t.t) && t.t.length <= 12));
const flagName = (t: string) => t.replace(/^[-/]+/, "").split(/[:=]/)[0].toLowerCase();
const hasFlag = (args: Tok[], shell: Shell, ...names: string[]) => args.some((a) => isFlag(a, shell) && names.includes(flagName(a.t)));
const hasShortFlag = (args: Tok[], ch: string) => args.some((a) => !a.quoted && /^-[a-z]+$/i.test(a.t) && a.t.slice(1).includes(ch));
const positional = (args: Tok[], shell: Shell) => args.filter((a) => !isFlag(a, shell));
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const AUTH_WORD = /^(?:login|logout|log-in|signin|sign-in|auth|authenticate|credential|credentials|token|tokens|adduser|passwd|password|secret|secrets|apikey|api-key|keyring|keychain|config(?:ure)?)$/i;
const AUTH_FLAG = /token|password|passwd|secret|api-?key|auth|credential|cookie|bearer/i;

const NAMES = {
  read: new Set(["ls", "dir", "gci", "get-childitem", "cat", "type", "gc", "get-content", "head", "tail", "wc", "tree", "du", "df", "file", "stat", "diff", "cmp",
    "md5sum", "sha1sum", "sha256sum", "get-filehash", "grep", "egrep", "fgrep", "rg", "findstr", "select-string", "sls", "test-path", "resolve-path", "get-item", "gi",
    "split-path", "join-path", "realpath", "readlink", "basename", "dirname", "ffprobe", "jq", "column", "nl", "od", "xxd", "hexdump", "strings"]),
  noPath: new Set(["pwd", "get-location", "gl", "whoami", "hostname", "nvidia-smi", "echo", "write-output", "write-host", "printf", "true", "false", "uname", "env", "printenv",
    "get-date", "get-process", "ps", "tasklist", "systeminfo", "ver", "nproc", "free", "uptime", "id", "get-command", "gcm", "where", "where.exe", "which", "command", "clear", "cls", "history",
    "sort", "uniq", "cut", "tr", "measure-object", "measure", "select-object", "select", "sort-object", "format-table", "ft", "format-list", "fl", "out-string", "out-null", "group-object", "where-object"]),
  cd: new Set(["cd", "chdir", "set-location", "sl", "pushd", "popd"]),
  del: new Set(["rm", "rmdir", "rd", "del", "erase", "remove-item", "ri", "unlink", "shred", "trash", "clear-content", "clc", "srm", "wipe"]),
  write: new Set(["mkdir", "md", "new-item", "ni", "touch", "cp", "copy", "copy-item", "cpi", "xcopy", "mv", "move", "move-item", "mi", "ren", "rename", "rename-item", "rni",
    "set-content", "add-content", "ac", "out-file", "tee", "tee-object", "ln", "unzip", "expand-archive", "compress-archive", "zip", "7z", "tar", "gzip", "gunzip"]),
  install: new Set(["winget", "choco", "scoop", "apt", "apt-get", "dnf", "yum", "pacman", "brew", "snap", "flatpak", "msiexec", "install-module", "install-package", "install-script",
    "uninstall-module", "uninstall-package", "add-appxpackage", "remove-appxpackage", "dism", "pipx", "gem", "update-module", "install-windowsfeature", "enable-windowsoptionalfeature"]),
  system: new Set(["reg", "regedit", "regsvr32", "rundll32", "bcdedit", "bootrec", "sc", "net", "netsh", "schtasks", "at", "shutdown", "restart-computer", "stop-computer", "logoff",
    "diskpart", "format", "format-volume", "chkdsk", "sfc", "powercfg", "set-executionpolicy", "set-itemproperty", "new-itemproperty", "remove-itemproperty", "rename-itemproperty",
    "stop-service", "start-service", "restart-service", "set-service", "new-service", "remove-service", "suspend-service", "stop-process", "spps", "kill", "taskkill", "pkill", "killall",
    "sudo", "su", "doas", "runas", "start-process", "saps", "start", "explorer", "invoke-item", "ii", "systemctl", "service", "launchctl", "crontab", "mount", "umount", "wsl", "wmic",
    "invoke-wmimethod", "invoke-cimmethod", "set-mppreference", "add-mppreference", "setx", "mklink", "set-alias", "new-alias", "sal", "add-type", "import-module", "ipmo",
    "chmod", "chown", "chgrp", "attrib", "icacls", "cacls", "takeown", "set-acl", "assoc", "ftype", "bitsadmin", "certutil", "start-bitstransfer", "mshta", "cscript", "wscript",
    "vssadmin", "wevtutil", "auditpol", "secedit", "gpupdate", "set-date", "date", "time", "set-timezone", "tzutil", "dd", "mkfs", "fdisk", "parted", "iptables", "ufw", "route",
    "set-netfirewallrule", "new-netfirewallrule", "disable-netadapter", "enable-netadapter", "set-dnsclientserveraddress", "invoke-expression", "iex", "invoke-command", "icm",
    "enter-pssession", "new-pssession", "set-variable", "sv", "set", "new-variable", "remove-variable", "cmdkey", "ssh-keygen", "ssh-add", "gpg", "openssl", "nohup", "disown", "exec", "eval", "source", ".", "xargs", "watch", "timeout", "time", "nice", "env-update", "alias", "function"]),
  network: new Set(["scp", "sftp", "ftp", "tftp", "ssh", "telnet", "nc", "ncat", "netcat", "socat", "rclone", "aws", "gcloud", "gsutil", "az", "azcopy", "vercel", "netlify", "firebase",
    "wrangler", "fly", "flyctl", "heroku", "railway", "surge", "twine", "stripe", "paypal", "mail", "mailx", "sendmail", "mutt", "send-mailmessage", "ntfy", "telegram-send", "huggingface-cli",
    "hf", "ngrok", "cloudflared", "tailscale", "youtube-upload", "invoke-restmethod", "irm", "doctl", "supabase", "gh-pages", "expo", "eas"]),
  shells: new Set(["powershell", "pwsh", "cmd", "bash", "sh", "zsh", "fish", "dash", "ksh", "wsl", "busybox"]),
};

/** Classify one pipeline stage. first: the first stage (later stages read their input from the pipe). */
function stage(seg: Seg, ctx: CmdCtx, first: boolean): Out {
  const { shell } = ctx;
  let words = seg.words;
  if (shell === "powershell" && words[0]?.t === "&") words = words.slice(1); // call operator
  if (!words.length) return L3("run something", "the command is empty");
  const raw = words[0].t, name = base(raw), args = words.slice(1), pos = positional(args, shell);

  // venv activation / deactivation: changes this session's state only
  if (/(?:^|[\\/])(?:scripts|bin)[\\/]activate(?:\.ps1|\.bat|\.fish)?$/i.test(raw) && !args.length) return inFolders([raw], ctx, L1("switch to this Python environment"));
  if ((name === "source" || name === ".") && args.length === 1 && /(?:^|[\\/])(?:scripts|bin)[\\/]activate(?:\.fish)?$/i.test(args[0].t)) return inFolders([args[0].t], ctx, L1("switch to this Python environment"));
  if (name === "deactivate" && !args.length) return L1("leave the Python environment");
  if (shell === "bash" && name === "export" && args.length === 1 && /^[A-Za-z_]\w*=[^=]*$/.test(args[0].t)) return envSet(args[0].t.split("=")[0]);
  if (shell === "cmd" && name === "set" && args.length === 1 && /^[A-Za-z_]\w*=.*$/.test(args[0].t)) return envSet(args[0].t.split("=")[0]);
  if ((shell === "cmd" && name === "set" && !args.length) || (shell === "powershell" && ["gci", "get-childitem", "dir", "ls"].includes(name) && args.length === 1 && /^env:\\?$/i.test(args[0].t))) return L1("list this session's settings");

  // a script or program by path: running his own code may change anything in its folder
  if (/[\\/]/.test(raw) && !NAMES.read.has(name)) {
    return inFolders([raw], ctx, L2(`run ${short(raw)}`));
  }
  if (NAMES.shells.has(name)) { // a script file of his: same as running it by path; inline/hidden commands stay level 3
    const file = ["powershell", "pwsh"].includes(name) && args.length === 2 && /^-f(?:ile)?$/i.test(args[0].t) ? args[1].t
      : ["bash", "sh", "zsh"].includes(name) && args.length === 1 && !isFlag(args[0], "bash") && /\.(?:sh|bash)$/i.test(args[0].t) ? args[0].t
      : ["powershell", "pwsh"].includes(name) && args.length === 1 && /\.ps1$/i.test(args[0].t) ? args[0].t : "";
    if (file) return inFolders([file], ctx, L2(`run ${short(file)}`));
    return L3(`start another ${name} shell`, "runs a hidden inner command that can't be checked"); }
  if (NAMES.install.has(name)) return L3(`${name} ${pos[0]?.t ?? ""}`.trim(), "installs or removes software");
  if (NAMES.system.has(name)) return L3(name, name === "chmod" || name === "attrib" || name === "icacls" ? "changes file permissions" : /kill|stop-process|spps/.test(name) ? "stops programs" : "changes the system or runs something hidden");
  if (NAMES.network.has(name)) return L3(name, "sends or publishes something over the network, or logs in");
  if (NAMES.del.has(name)) return L3(`delete ${pos.map((a) => short(a.t)).join(", ") || "files"}`, "deletes files");

  if (NAMES.cd.has(name)) {
    if (name === "popd") return L1("go back to the previous folder");
    const target = pos[0]?.t;
    if (!target) return shell === "bash" ? L3("go to the home folder", "outside your connected folders") : L1("show the current folder");
    if (target === "-") return L3("go to the previous folder", "can't tell where that is");
    return inFolders([target], ctx, L1(`go to ${short(target)}`));
  }
  if (NAMES.noPath.has(name)) {
    if (name === "env" && args.length) return L3(name, "runs a command with changed settings");
    if (name === "printenv" && (args.length > 1 || (args[0] && !/^[A-Za-z_]\w*$/.test(args[0].t)))) return L3(name, "an odd printenv");
    if (name === "command" && !hasShortFlag(args, "v")) return L3(name, "runs a hidden inner command");
    if (name === "where-object" || name === "select-object" || name === "select") return L1("filter the output");
    return L1(name === "echo" || name === "write-output" || name === "write-host" || name === "printf" ? "print text" : `show ${name}`);
  }
  if (NAMES.read.has(name)) {
    if (name === "tar") return tarCmd(args, ctx);
    const paths = pos.map((a) => a.t).filter((t) => name !== "grep" && name !== "rg" && name !== "findstr" && name !== "select-string" && name !== "sls" ? true : true);
    // the first positional of a search tool is the pattern, not a path
    const files = ["grep", "egrep", "fgrep", "rg", "findstr"].includes(name) ? paths.slice(1) : ["select-string", "sls"].includes(name) && !hasFlag(args, shell, "pattern") ? paths.slice(1) : paths;
    if (name === "get-content" || name === "gc" || name === "cat" || name === "type") { if (hasFlag(args, shell, "stream")) return L3(name, "reads hidden file streams"); }
    const recursive = ["grep", "rg", "du", "tree", "dir", "ls", "gci", "get-childitem", "findstr"].includes(name);
    return inFolders(files.length ? files : first && recursive ? ["."] : [], ctx, L1(readWhat(name, files)), true);
  }
  if (name === "find") return findCmd(args, ctx);
  if (name === "sed") {
    if (hasShortFlag(args, "i") || hasFlag(args, shell, "in-place")) return inFolders(pos.slice(1).map((a) => a.t), ctx, L2(`edit ${pos.slice(1).map((a) => short(a.t)).join(", ")}`, targets(pos.slice(1).map((a) => a.t), ctx)));
    const script = pos[0]?.t ?? "";
    if (!/^s(.).*\1.*\1[gip0-9]*$/.test(script) && !/^\d*,?\d*p$/.test(script)) return L3("sed", "a sed program that may write or run things");
    return inFolders(pos.slice(1).map((a) => a.t), ctx, L1("edit text in the output"), true);
  }
  if (name === "awk" || name === "gawk") return inFolders(pos.slice(1).map((a) => a.t), ctx, L2("run an awk program"));
  if (NAMES.write.has(name)) return writeCmd(name, args, ctx);
  if (name === "git") return gitCmd(args, ctx);
  if (["npm", "pnpm", "yarn", "bun"].includes(name)) return npmCmd(name, args, ctx);
  if (name === "npx" || name === "pnpx" || name === "bunx") return npxCmd(args, ctx);
  if (["node", "deno", "tsx", "ts-node"].includes(name)) return nodeCmd(name, args, ctx);
  if (["python", "python3", "py"].includes(name)) return pythonCmd(args, ctx);
  if (name === "pip" || name === "pip3") return pipCmd(args);
  if (name === "pytest") return inFolders(pos.map((a) => a.t), ctx, L1("run Python tests"));
  if (name === "uv") return uvCmd(args, ctx);
  if (name === "conda" || name === "mamba") {
    const sub = pos[0]?.t.toLowerCase();
    if (sub === "activate" || sub === "deactivate") return L1(`${sub} a conda environment`);
    if (sub === "list" || sub === "info" || (sub === "env" && pos[1]?.t.toLowerCase() === "list")) return L1("list conda environments");
    return L3(`conda ${sub ?? ""}`.trim(), "installs or removes software");
  }
  if (name === "ffmpeg") return ffmpegCmd(args, ctx);
  if (name === "kaggle") return kaggleCmd(args, ctx);
  if (["curl", "wget", "invoke-webrequest", "iwr"].includes(name)) return webCmd(name, args, ctx);
  if (name === "rsync") return pos.some((a) => /^[^\\/]*:|^rsync:\/\//i.test(a.t) && !/^[a-z]:[\\/]/i.test(a.t)) ? L3("rsync", "copies files to another computer") : rsyncLocal(args, ctx);
  if (name === "gh") return ghCmd(args);
  if (name === "docker" || name === "podman") return dockerCmd(args, ctx);
  if (name === "blender") return hasFlag(args, shell, "python", "p", "python-expr", "python-text") ? L3("blender with a script", "runs a hidden script") : inFolders(pos.map((a) => a.t), ctx, hasShortFlag(args, "b") || hasFlag(args, shell, "background") ? L1("render with Blender") : L3("open Blender", "opens a window and waits"));
  if (["make", "cmake", "ninja", "msbuild", "gradle", "mvn"].includes(name)) return buildTool(name, args, ctx);
  if (name === "cargo" || name === "go" || name === "dotnet") return langTool(name, args, ctx);
  if (["tsc", "eslint", "prettier", "ruff", "black", "mypy", "pyright", "jest", "vitest", "next", "vite", "remotion", "selene", "stylua", "rojo"].includes(name)) return devTool(name, args, ctx);
  if (name === "yt-dlp" || name === "youtube-dl") return pos.some((a) => URL_RE.test(a.t) && /[?&]list=/.test(a.t)) ? L2("download videos", ["*"]) : L2("download a video", ["*"]);
  if (name === "magick" || name === "convert") return inFolders(pos.map((a) => a.t), ctx, L2("convert an image", targets(pos.slice(-1).map((a) => a.t), ctx)));
  return L3(`run ${name}`, "a command ORBIT doesn't know, so it can't tell what it does");
}

const short = (s: string) => (s.length > 60 ? "\u2026" + s.slice(-59) : s);
const envSet = (key: string): Out => /^(?:path|pythonpath|node_options|ld_preload|ld_library_path|comspec|pathext|psmodulepath)$/i.test(key) || AUTH_FLAG.test(key) || /key$/i.test(key)
  ? L3(`set ${key}`, /path|preload|comspec|psmodule|node_options/i.test(key) ? "changes which programs run" : "sets a password or key")
  : L1(`set ${key} for this session`);
const readWhat = (name: string, files: string[]) => {
  const f = files.length ? ` ${files.slice(0, 3).map(short).join(", ")}` : "";
  if (["ls", "dir", "gci", "get-childitem", "tree"].includes(name)) return `list files${f}`;
  if (["cat", "type", "gc", "get-content", "head", "tail"].includes(name)) return `read${f || " a file"}`;
  if (["grep", "egrep", "fgrep", "rg", "findstr", "select-string", "sls"].includes(name)) return `search${f ? ` in${f}` : " files"}`;
  return `look at${f || " files"}`;
};
const targets = (raw: string[], ctx: CmdCtx) => raw.map((r) => resolveArg(r, ctx.cwd, ctx.home)).filter((p): p is string => !!p);

/** Paths must be inside connected folders (and not private/system/secret). read: listing a parent of private data is private too. */
function inFolders(raw: string[], ctx: CmdCtx, ok: Out, _read = false): Out {
  for (const r of raw) {
    if (URL_RE.test(r)) return L3(ok.what, "uses a web address");
    const p = resolveArg(r, ctx.cwd, ctx.home);
    if (!p) return L3(ok.what, "uses a path ORBIT can't check (a network share or odd form)");
    if (secretName(p)) return L3(ok.what, "touches passwords, keys or login files");
    const w = where(p, ctx);
    if (w === "private" || privateName(p, normPath(ctx.cwd) ?? "")) return { ...L3(ok.what, "touches VAULT, journal or LIFE files: private, so only you see the output"), private: true };
    if (w === "system") return L3(ok.what, "touches system folders");
    if (w === "outside") return L3(ok.what, "is outside your connected folders");
  }
  return ok;
}

function writeCmd(name: string, args: Tok[], ctx: CmdCtx): Out {
  const pos = positional(args, ctx.shell).map((a) => a.t);
  if (["new-item", "ni"].includes(name) && args.some((a, i) => isFlag(a, ctx.shell) && ["itemtype", "type"].includes(flagName(a.t)) && /link|junction/i.test(args[i + 1]?.t ?? ""))) return L3("make a link", "creates links that can point anywhere");
  if (name === "ln") return L3("make a link", "creates links that can point anywhere");
  if (["xcopy", "robocopy"].includes(name) && hasFlag(args, ctx.shell, "mir", "purge", "mov", "move")) return L3(name, "deletes or moves files away");
  if (["mv", "move", "move-item", "mi", "cp", "copy", "copy-item", "cpi", "xcopy"].includes(name) && hasFlag(args, ctx.shell, "force", "f") && ["mv", "move", "move-item", "mi"].includes(name)) {/* overwrite: covered by the snapshot */}
  if (name === "tar") return tarCmd(args, ctx);
  const verb = ["mkdir", "md"].includes(name) ? "make folder" : ["mv", "move", "move-item", "mi", "ren", "rename", "rename-item", "rni"].includes(name) ? "move/rename" : ["cp", "copy", "copy-item", "cpi", "xcopy"].includes(name) ? "copy" : ["unzip", "expand-archive", "7z", "gunzip"].includes(name) ? "unpack" : ["compress-archive", "zip", "gzip"].includes(name) ? "pack" : "write";
  if (name === "7z" && !/^[xe]$/i.test(pos[0] ?? "") && !/^a$/i.test(pos[0] ?? "")) return L3("7z", "an archive action ORBIT doesn't know");
  const files = name === "7z" ? pos.slice(1) : name === "tee" || name === "tee-object" || name === "touch" || name.startsWith("mkdir") || name === "md" ? pos : pos;
  const moving = verb === "move/rename";
  // a move changes the source too; a copy/pack/unpack only the destination (unpack: the whole folder it unpacks into)
  const writes = verb === "unpack" ? ["*"] : moving || verb === "make folder" || verb === "write" ? targets(files, ctx) : targets(files.slice(-1), ctx);
  if (!files.length) return L3(name, "no file given, so ORBIT can't tell what it changes");
  return inFolders(files, ctx, L2(`${verb} ${files.slice(0, 3).map(short).join(" → ")}`, writes));
}
function tarCmd(args: Tok[], ctx: CmdCtx): Out {
  const flags = args.filter((a) => !a.quoted && /^-?[a-zA-Z]+$/.test(a.t)).map((a) => a.t.replace(/^-/, "")).join("");
  const pos = positional(args, ctx.shell).map((a) => a.t).filter((t) => !/^[a-zA-Z]+$/.test(t) || t.includes("."));
  if (/t/.test(flags) && !/[xc]/.test(flags)) return inFolders(pos, ctx, L1("list an archive"));
  if (/x/.test(flags)) return inFolders(pos, ctx, L2("unpack an archive", ["*"]));
  if (/c/.test(flags)) return inFolders(pos, ctx, L2("pack an archive", targets(pos.slice(0, 1), ctx)));
  return L3("tar", "an archive action ORBIT doesn't know");
}
function findCmd(args: Tok[], ctx: CmdCtx): Out {
  if (hasFlag(args, ctx.shell, "delete", "exec", "execdir", "ok", "okdir", "fprint", "fprint0", "fprintf", "fls")) return L3("find and act on files", "deletes or runs things on the files it finds");
  const pos = positional(args, ctx.shell).map((a) => a.t);
  // POSIX find: paths come first; Windows find.exe: "text" then files. Either way every positional is checked as a path except
  // values that follow a test (-name x): conservative, a name pattern resolves inside cwd.
  return inFolders(pos.length ? pos : ["."], ctx, L1("find files"), true);
}
function rsyncLocal(args: Tok[], ctx: CmdCtx): Out {
  if (hasFlag(args, ctx.shell, "delete", "delete-before", "delete-after", "delete-during", "remove-source-files")) return L3("rsync", "deletes files");
  const pos = positional(args, ctx.shell).map((a) => a.t);
  return inFolders(pos, ctx, L2("copy files", targets(pos.slice(-1), ctx)));
}

const MAIN = /^(?:main|master|trunk|production|prod|release)$/i;
function gitCmd(args: Tok[], ctx: CmdCtx): Out {
  let i = 0, cwd = ctx.cwd;
  while (args[i] && isFlag(args[i], "bash")) {
    const f = args[i].t;
    if (f === "-C" && args[i + 1]) { const p = resolveArg(args[i + 1].t, ctx.cwd, ctx.home); if (!p) return L3("git", "uses a path ORBIT can't check"); cwd = p; i += 2; continue; }
    if (f === "--no-pager" || f === "--no-optional-locks" || f === "-P") { i++; continue; }
    if (f === "--version") return L1("show the git version");
    return L3("git", "git with options that change how it runs (config, paths, credentials)");
  }
  const c2: CmdCtx = { ...ctx, cwd };
  const gate = inFolders(["."], c2, L1("git"));
  if (gate.level === 3) return gate;
  const sub = args[i]?.t.toLowerCase() ?? "", rest = args.slice(i + 1), pos = positional(rest, "bash").map((a) => a.t);
  const paths = (list: string[]) => inFolders(list, c2, L1("git"));
  const withPaths = (o: Out, list: string[]) => { const g = paths(list); return g.level === 3 ? { ...g, what: o.what } : o; };
  switch (sub) {
    case "": case "help": case "version": return L1("show git help");
    case "status": case "diff": case "log": case "show": case "blame": case "shortlog": case "describe": case "rev-parse": case "ls-files": case "grep": case "reflog": case "whatchanged": case "cat-file": case "ls-tree": case "rev-list": case "count-objects": case "show-ref": case "merge-base": case "name-rev": case "range-diff":
      if (hasFlag(rest, "bash", "output", "ext-diff", "textconv") || (sub === "reflog" && ["expire", "delete"].includes(pos[0] ?? ""))) return L3(`git ${sub}`, "writes files or runs outside programs");
      return withPaths(L1(sub === "status" ? "check what changed (git status)" : sub === "diff" ? "show the changes (git diff)" : sub === "log" ? "show the history (git log)" : `git ${sub}`), sub === "grep" ? [] : pos.filter((p) => !/^[0-9a-f]{4,40}$|^HEAD|\.\.|^@|^origin\//i.test(p)).filter((p) => p.includes("/") || p.includes("\\") || p.includes(".")));
    case "branch": {
      if (hasFlag(rest, "bash", "d", "D", "delete", "M", "m", "move", "f", "force", "c", "C", "copy", "u", "set-upstream-to", "unset-upstream", "edit-description")) return L3("git branch", hasFlag(rest, "bash", "d", "D", "delete") ? "deletes a branch" : "renames or rewires a branch");
      return pos.length && !hasFlag(rest, "bash", "list", "l", "a", "r", "contains", "merged", "no-merged", "show-current", "v", "vv") ? L2(`make branch ${pos[0]}`, []) : L1("list branches");
    }
    case "tag": return hasFlag(rest, "bash", "d", "delete", "f", "force") ? L3("git tag", "deletes or moves a tag") : pos.length && !hasFlag(rest, "bash", "l", "list") ? L2(`tag ${pos[0]}`, []) : L1("list tags");
    case "remote": return !pos.length || (["show", "get-url"].includes(pos[0]) && true) ? L1("list remotes") : L3("git remote", "changes where code is sent");
    case "stash": return !pos.length || ["push", "save"].includes(pos[0]) ? L2("put changes aside (git stash)") : ["list", "show"].includes(pos[0]) ? L1("list stashes") : ["pop", "apply"].includes(pos[0]) ? L2("bring stashed changes back") : L3("git stash", pos[0] === "drop" || pos[0] === "clear" ? "deletes stashed work" : "a stash action ORBIT doesn't know");
    case "fetch": return pos.some((p) => URL_RE.test(p) || p.includes("@")) || hasFlag(rest, "bash", "prune", "p", "prune-tags", "upload-pack") ? L3("git fetch", "fetches from an address ORBIT can't check, or deletes branches") : L1("fetch new commits (git fetch)");
    case "add": return hasFlag(rest, "bash", "i", "interactive", "p", "patch", "e", "edit") ? L3("git add", "waits for typed answers") : withPaths(L1(`stage ${pos.length ? pos.slice(0, 3).join(", ") : "changes"}`), pos);
    case "commit": {
      if (hasFlag(rest, "bash", "S", "gpg-sign", "no-verify", "n") ) return L3("git commit", hasFlag(rest, "bash", "S", "gpg-sign") ? "signs with your key" : "skips the project's checks");
      if (!hasFlag(rest, "bash", "m", "message", "F", "file", "C", "reuse-message", "no-edit") && !rest.some((a) => /^-[a-zA-Z]*m$/.test(a.t))) return L3("git commit", "opens an editor and waits");
      const b = ctx.branch ?? "";
      if (!b || b === "HEAD" || MAIN.test(b)) return L3(`commit on ${b || "an unknown branch"}`, b && b !== "HEAD" ? `commits straight to ${b}` : "can't tell which branch this is");
      return L1(`save a commit on ${b}`);
    }
    case "push": return L3(`push to GitHub${pos.length ? ` (${pos.join(" ")})` : ""}`, pos.some((p) => MAIN.test(p.split(":").pop() ?? "")) || MAIN.test(ctx.branch ?? "") || hasFlag(rest, "bash", "f", "force", "force-with-lease", "mirror", "delete", "d") ? "uploads to main or overwrites history" : "uploads code to the internet");
    case "switch": case "checkout": {
      if (rest.some((a) => a.t === "--") || pos.some((p) => p === "." || p.includes("\\") || (sub === "checkout" && p.includes("/") && /\.[\w]+$/.test(p))) || hasFlag(rest, "bash", "f", "force", "discard-changes", "p", "patch", "ours", "theirs")) return L3(`git ${sub}`, "throws away uncommitted changes");
      return L2(`switch to branch ${pos.at(-1) ?? ""}`.trim());
    }
    case "merge": case "rebase": case "cherry-pick": case "revert": case "pull": case "am": case "apply": case "mv": case "init": case "restore":
      if (sub === "restore") return hasFlag(rest, "bash", "staged", "S") && !hasFlag(rest, "bash", "worktree", "W") ? L1("unstage files") : L3("git restore", "throws away uncommitted changes");
      if (hasFlag(rest, "bash", "i", "interactive", "exec", "x", "strategy-option")) return L3(`git ${sub}`, "waits for typed answers or runs commands");
      if (sub === "pull" && pos.some((p) => URL_RE.test(p) || p.includes("@"))) return L3("git pull", "pulls from an address ORBIT can't check");
      if (sub === "merge" || sub === "pull") { if (!hasFlag(rest, "bash", "no-edit", "ff-only", "abort", "continue", "m") && sub === "merge") return L3("git merge", "opens an editor and waits"); }
      return L2(`git ${sub}`);
    case "clone": {
      const src = pos[0] ?? "";
      if (!/^https:\/\/[\w.-]+\/[\w.\/-]+$/i.test(src)) return L3("git clone", "clones from an address ORBIT can't check");
      return inFolders(pos.slice(1), c2, L2(`copy the project ${short(src)}`, pos[1] ? targets([pos[1]], c2) : ["*"]));
    }
    case "reset": return hasFlag(rest, "bash", "hard", "merge", "keep") ? L3("git reset", "throws away work") : L2("git reset (keeps your files)");
    case "clean": case "rm": case "gc": case "prune": case "filter-branch": case "filter-repo": case "update-ref": case "worktree": case "submodule": case "lfs": case "config": case "credential": case "credential-manager": case "send-email": case "request-pull": case "archive": case "bundle": case "daemon": case "instaweb": case "svn": case "p4": case "replace": case "notes": case "hook": case "bisect": case "sparse-checkout": case "maintenance":
      return L3(`git ${sub}`, sub === "clean" || sub === "rm" || sub === "prune" || sub === "gc" ? "deletes files" : sub === "config" || sub.startsWith("credential") ? "changes git settings or passwords" : sub === "send-email" || sub === "request-pull" ? "sends something" : "a git action that needs your OK");
    default: return L3(`git ${sub}`, "a git action ORBIT doesn't know");
  }
}

const SAFE_SCRIPT = /^(?:build|test|tests|lint|typecheck|type-check|check|dev|start|serve|preview|render|eval|e2e|smoke|bench|storybook|docs?)(?:[:_-][\w:.-]*)?$/i;
const PUB_SCRIPT = /deploy|publish|release|upload|push|ship|submit|send|post|tweet|login|auth/i;
const DEL_SCRIPT = /install|clean|clear|reset|purge|nuke|wipe|rm\b|remove|delete|uninstall|prune|drop|migrate|seed/i;
const FIX_SCRIPT = /fix|format|fmt|write|gen|codegen|update|bump|snapshot/i;
function script(name: string, what: string): Out {
  if (PUB_SCRIPT.test(name)) return L3(what, "a script named like publishing or sending");
  if (DEL_SCRIPT.test(name)) return L3(what, "a script named like installing or deleting");
  if (SAFE_SCRIPT.test(name) && !FIX_SCRIPT.test(name)) return L1(what);
  return L2(what);
}
function npmCmd(tool: string, args: Tok[], ctx: CmdCtx): Out {
  const gate = inFolders(["."], ctx, L1(tool));
  if (gate.level === 3) return gate;
  const pos = positional(args, "bash").map((a) => a.t);
  if (!pos.length) return hasFlag(args, "bash", "v", "version", "help", "h") ? L1(`show the ${tool} version`) : L3(tool, "nothing to run");
  const sub = pos[0].toLowerCase();
  if (hasFlag(args, "bash", "g", "global", "location", "prefix", "userconfig", "registry", "workspaces", "w", "workspace", "ws")) return L3(`${tool} ${sub}`, "changes settings or software outside this project");
  if (["test", "t", "tst"].includes(sub)) return L1("run the tests");
  if (sub === "start") return L1("start the project");
  if (["run", "run-script", "rum", "urn"].includes(sub)) { const s = pos[1]; return s ? script(s, `run the ${s} script`) : L1("list scripts"); }
  if (["ls", "list", "la", "ll", "outdated", "view", "info", "show", "v", "why", "explain", "help", "search", "find-dupes", "fund", "doctor", "bin", "root", "prefix", "query", "sbom", "licenses"].includes(sub)) return L1(`${tool} ${sub}`);
  if (sub === "audit") return pos[1] === "fix" ? L3("npm audit fix", "installs packages") : L1("check packages for known problems");
  if (["init", "create", "version", "pkg"].includes(sub)) return sub === "create" || (sub === "init" && pos[1]) ? L3(`${tool} ${sub}`, "downloads and runs a starter package") : L2(`${tool} ${sub}`, sub === "pkg" ? targets(["package.json"], ctx) : ["*"]);
  if (["install", "i", "ci", "add", "isntall", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "uninstall", "remove", "rm", "r", "un", "unlink", "update", "up", "upgrade", "udpate", "link", "ln", "rebuild", "rb", "dedupe", "ddp", "prune", "install-test", "it", "install-ci-test", "cit", "dlx", "patch"].includes(sub)) return L3(`${tool} ${sub} ${pos.slice(1).join(" ")}`.trim(), "installs or removes packages");
  if (["publish", "unpublish", "deprecate", "dist-tag", "owner", "access", "team", "org", "hook", "star", "unstar", "stars"].includes(sub)) return L3(`${tool} ${sub}`, "publishes or changes something online");
  if (["login", "logout", "adduser", "add-user", "token", "whoami", "profile", "config", "c", "set", "get", "cache"].includes(sub)) return L3(`${tool} ${sub}`, "logins, passwords or settings");
  if (["exec", "x"].includes(sub)) return npxCmd(args.slice(args.findIndex((a) => a.t.toLowerCase() === pos[0]) + 1), ctx);
  if (tool !== "npm") return script(sub, `run the ${sub} script`); // yarn/pnpm/bun <script>
  return L3(`npm ${sub}`, "an npm action ORBIT doesn't know");
}
function npxCmd(args: Tok[], ctx: CmdCtx): Out {
  if (hasFlag(args, "bash", "y", "yes", "p", "package", "c", "call", "ignore-existing")) return L3("npx", "downloads and runs a package");
  const words = args.filter((a) => !isFlag(a, "bash"));
  const bin = words[0]?.t.toLowerCase().replace(/@[\w.^~-]+$/, "") ?? "";
  if (!bin) return L3("npx", "nothing to run");
  const rest = args.slice(args.indexOf(words[0]) + 1);
  if (["tsc", "eslint", "prettier", "jest", "vitest", "next", "vite", "remotion", "playwright", "tsx", "ts-node", "rollup", "webpack", "esbuild", "turbo", "astro", "svelte-check", "stylelint", "biome", "knip", "depcheck", "c8", "nyc", "mocha", "ava", "hyperframes", "serve", "http-server"].includes(bin)) {
    if (bin === "tsx" || bin === "ts-node") return nodeCmd(bin, rest, ctx);
    if (bin === "serve" || bin === "http-server") return L3(`npx ${bin}`, "opens a web server other devices may reach");
    return devTool(bin, rest, ctx);
  }
  return L3(`npx ${bin}`, "may download and run a package ORBIT doesn't know");
}
function devTool(name: string, args: Tok[], ctx: CmdCtx): Out {
  const gate = inFolders(positional(args, "bash").map((a) => a.t).filter((t) => /[\\/.]/.test(t)), ctx, L1(name));
  if (gate.level === 3) return gate;
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  const writes = hasFlag(args, "bash", "fix", "write", "w", "fix-only", "u", "update-snapshot", "updatesnapshot", "init");
  if (name === "next") { if (pos[0] === "build" || pos[0] === "lint" || pos[0] === "dev" || pos[0] === "start" || pos[0] === "info") return writes ? L2("fix code with next lint") : L1(`next ${pos[0]}`); return L3(`next ${pos[0] ?? ""}`.trim(), "a next action ORBIT doesn't know"); }
  if (name === "remotion") { if (["render", "still", "studio", "preview", "compositions", "benchmark"].includes(pos[0])) return L1(`render with Remotion (${pos[0]})`); return L3(`remotion ${pos[0] ?? ""}`.trim(), pos[0] === "lambda" || pos[0] === "cloudrun" ? "renders in the cloud (costs money)" : "a Remotion action ORBIT doesn't know"); }
  if (name === "rojo") return ["build", "sourcemap"].includes(pos[0]) ? L2(`rojo ${pos[0]}`) : pos[0] === "serve" ? L1("start Rojo live sync") : L3(`rojo ${pos[0] ?? ""}`.trim(), pos[0] === "upload" ? "uploads to Roblox" : "a Rojo action ORBIT doesn't know");
  if (name === "playwright") return pos[0] === "test" || pos[0] === "show-report" ? L1("run browser tests") : L3(`playwright ${pos[0] ?? ""}`.trim(), "installs browsers or opens a recorder");
  if (name === "prettier") return writes ? L2("format code") : L1("check code formatting");
  if (name === "black" || (name === "ruff" && pos[0] === "format")) return hasFlag(args, "bash", "check", "diff") ? L1("check code formatting") : L2("format code");
  if (name === "stylua") return hasFlag(args, "bash", "check") ? L1("check code formatting") : L2("format code");
  return writes ? L2(`${name} with fixes`) : L1(name === "tsc" ? "type-check the code" : name === "eslint" || name === "ruff" || name === "selene" ? "check the code" : name === "jest" || name === "vitest" ? "run the tests" : `run ${name}`);
}
function nodeCmd(name: string, args: Tok[], ctx: CmdCtx): Out {
  if (hasFlag(args, "bash", "v", "version", "help", "h")) return L1(`show the ${name} version`);
  if (hasFlag(args, "bash", "e", "eval", "p", "print", "i", "interactive", "r", "require", "import", "loader", "experimental-loader", "inspect", "inspect-brk", "allow-all", "A")) return L3(`${name} with inline code`, "runs code that isn't in a file");
  const pos = positional(args, "bash").map((a) => a.t);
  if (hasFlag(args, "bash", "check", "c") && pos.length) return inFolders(pos, ctx, L1(`check ${short(pos[0])}`));
  if (hasFlag(args, "bash", "test")) return inFolders(pos.length ? pos : ["."], ctx, L1("run the tests"));
  if (name === "deno" && !["run", "test", "check", "fmt", "lint"].includes(pos[0])) return L3(`deno ${pos[0] ?? ""}`.trim(), "a deno action ORBIT doesn't know");
  if (name === "deno") { if (pos[0] === "test" || pos[0] === "check" || (pos[0] === "lint" && !hasFlag(args, "bash", "fix")) || (pos[0] === "fmt" && hasFlag(args, "bash", "check"))) return L1(`deno ${pos[0]}`); pos.shift(); }
  if (!pos.length) return L3(name, "opens an interactive prompt that waits");
  return inFolders([pos[0]], ctx, L2(`run ${short(pos[0])}`));
}
function pythonCmd(args: Tok[], ctx: CmdCtx): Out {
  if (hasFlag(args, "bash", "v", "version")) return L1("show the Python version");
  if (args.some((a) => a.t === "-c" || a.t === "-i" || /^-[a-zA-Z]*c$/.test(a.t))) return L3("python with inline code", "runs code that isn't in a file");
  const mi = args.findIndex((a) => a.t === "-m");
  if (mi >= 0) {
    const mod = args[mi + 1]?.t.toLowerCase() ?? "", rest = args.slice(mi + 2), pos = positional(rest, "bash").map((a) => a.t);
    if (mod === "pip") return pipCmd(rest);
    if (mod === "pytest" || mod === "unittest") return inFolders(pos, ctx, L1("run Python tests"));
    if (mod === "venv" || mod === "virtualenv") return pos.length === 1 ? inFolders(pos, ctx, L2(`make the Python environment ${short(pos[0])}`, targets(pos, ctx))) : L3("python -m venv", "no single folder given");
    if (mod === "kaggle") return kaggleCmd(rest, ctx);
    if (["http.server", "smtpd", "ftplib", "smtplib", "webbrowser", "ensurepip", "pipx", "twine", "huggingface_hub", "pydoc", "idlelib", "code", "pdb"].includes(mod)) return L3(`python -m ${mod}`, mod === "http.server" ? "opens a web server" : mod === "ensurepip" || mod === "pipx" ? "installs software" : "sends, publishes or waits for typing");
    if (["black", "ruff", "mypy", "pyright", "flake8", "pylint", "isort"].includes(mod)) return devTool(mod, rest, ctx);
    if (!/^[a-z_][\w.]*$/.test(mod)) return L3("python -m", "an odd module name");
    return L2(`run the Python module ${mod}`);
  }
  const pos = positional(args, "bash").map((a) => a.t);
  if (!pos.length) return L3("python", "opens an interactive prompt that waits");
  return inFolders([pos[0]], ctx, L2(`run ${short(pos[0])}`));
}
function pipCmd(args: Tok[]): Out {
  const sub = positional(args, "bash")[0]?.t.toLowerCase() ?? "";
  if (hasFlag(args, "bash", "version", "V") && !sub) return L1("show the pip version");
  if (["list", "show", "freeze", "check", "help", "inspect", "search", "index"].includes(sub)) return L1(`pip ${sub}`);
  return L3(`pip ${sub}`.trim(), sub === "config" ? "changes settings" : "installs or removes Python packages");
}
function uvCmd(args: Tok[], ctx: CmdCtx): Out {
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  if (pos[0] === "run") return inFolders(pos.slice(1, 2).filter((p) => p.endsWith(".py")), ctx, hasFlag(args, "bash", "with", "w") ? L3("uv run --with", "installs packages") : L2(`run ${pos[1] ?? ""}`.trim()));
  if (pos[0] === "pip" && ["list", "show", "freeze", "check", "tree"].includes(pos[1])) return L1(`uv pip ${pos[1]}`);
  if (pos[0] === "venv") return L2("make a Python environment", pos[1] ? targets([pos[1]], ctx) : targets([".venv"], ctx));
  if (["tree", "version", "help"].includes(pos[0]) || hasFlag(args, "bash", "version", "V")) return L1(`uv ${pos[0] ?? "version"}`);
  return L3(`uv ${pos.slice(0, 2).join(" ")}`.trim(), "installs or removes Python packages");
}
function ffmpegCmd(args: Tok[], ctx: CmdCtx): Out {
  const toks = args.map((a) => a.t);
  if (toks.some((t) => URL_RE.test(t) && !/^file:/i.test(t)) || toks.some((t) => /^(?:rtmps?|srt|udp|tcp|rtp|rtsp|icecast|ftp|sftp|http|https|pipe|concat|subfile|tee):/i.test(t))) return L3("ffmpeg with a web address", "streams or uploads over the network");
  if (toks.some((t) => /^file:/i.test(t))) return L3("ffmpeg", "uses a file: address ORBIT can't check");
  if (hasFlag(args, "bash", "version", "h", "help", "formats", "codecs", "encoders", "decoders", "filters", "hwaccels", "devices", "protocols", "pix_fmts")) return L1("show ffmpeg info");
  // inputs follow -i; everything else that isn't a flag value is checked as a path too (conservative)
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) { if (args[i].t === "-i" && args[i + 1]) { paths.push(args[i + 1].t); i++; } }
  const out = args.at(-1)?.t ?? "";
  if (!out || isFlag(args.at(-1)!, "bash") || paths.includes(out)) return L3("ffmpeg", "no output file, so ORBIT can't tell what it writes");
  if (toks.some((t) => /movie=|amovie=|sendcmd|zmq|azmq|-filter_script|-filter_complex_script|-attach|-dump_attachment/i.test(t))) return L3("ffmpeg", "reads or writes files ORBIT can't see");
  const o = inFolders([...paths, out], ctx, hasFlag(args, "bash", "y") ? L2(`render ${short(out)} (overwrites it)`, targets([out], ctx)) : L1(`render ${short(out)}`));
  return { ...o, writes: o.level === 3 ? [] : targets([out], ctx) };
}
function kaggleCmd(args: Tok[], ctx: CmdCtx): Out {
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  const [group, act] = [pos[0] ?? "", pos[1] ?? ""];
  const g = group.replace(/^(?:c|competition)$/, "competitions").replace(/^(?:d|dataset)$/, "datasets").replace(/^(?:k|kernel)$/, "kernels").replace(/^(?:m|model)$/, "models");
  if (g === "config") return L3("kaggle config", "changes your Kaggle login settings");
  if (["list", "files", "status", "leaderboard", "metadata", "submissions"].includes(act) && !(act === "leaderboard" && hasFlag(args, "bash", "download", "d")) && !(act === "metadata" && hasFlag(args, "bash", "update"))) return L1(`look at Kaggle ${g} (${act})`);
  if (["download", "output", "pull", "init"].includes(act) || (act === "leaderboard" && hasFlag(args, "bash", "download", "d"))) {
    const pi = args.findIndex((a) => ["-p", "--path"].includes(a.t));
    const dest = pi >= 0 && args[pi + 1] ? [args[pi + 1].t] : ["."];
    return inFolders(dest, ctx, L2(`download from Kaggle ${g} into ${short(dest[0])}`, targets(dest, ctx)));
  }
  if (["submit", "create", "version", "push", "delete", "upload"].includes(act)) return L3(`kaggle ${g} ${act}`, act === "delete" ? "deletes something on Kaggle" : act === "submit" ? "sends a submission to Kaggle" : "publishes to Kaggle");
  return L3(`kaggle ${pos.slice(0, 2).join(" ")}`.trim(), "a Kaggle action ORBIT doesn't know");
}
function webCmd(name: string, args: Tok[], ctx: CmdCtx): Out {
  const toks = args.map((a) => a.t), urls = toks.filter((t) => URL_RE.test(t) || /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(t));
  const ps = name === "invoke-webrequest" || name === "iwr" || (ctx.shell === "powershell" && (name === "curl" || name === "wget")); // Windows PowerShell 5.1: curl/wget are iwr
  const upload = hasFlag(args, "bash", "x", "request", "d", "data", "data-raw", "data-binary", "data-urlencode", "data-ascii", "json", "f", "form", "form-string", "t", "upload-file", "u", "user", "h", "header", "b", "cookie", "c", "cookie-jar", "k", "insecure", "config", "k", "oauth2-bearer", "aws-sigv4", "netrc", "netrc-file", "e", "referer", "a", "user-agent", "post-data", "post-file", "method", "body-data", "body-file", "header", "http-user", "http-password", "password", "user", "load-cookies", "save-cookies")
    || (ps && hasFlag(args, ctx.shell, "method", "body", "infile", "credential", "headers", "websession", "sessionvariable", "usedefaultcredentials", "authentication", "token", "certificate", "form", "contenttype", "customMethod"));
  // curl -X GET is a read; -K/-k: config / insecure
  const onlyGet = hasFlag(args, "bash", "x", "request") && toks.some((t, i) => ["-X", "--request"].includes(toks[i - 1] ?? "") && /^get$/i.test(t)) && !hasFlag(args, "bash", "d", "data", "data-raw", "data-binary", "f", "form", "t", "upload-file", "u", "user", "h", "header", "b", "cookie");
  if (upload && !onlyGet) return L3(`${name} ${urls[0] ?? ""}`.trim(), "sends data, a login or a file over the network");
  if (!urls.length) return L3(name, "no web address ORBIT can check");
  if (urls.some((u) => !/^https?:\/\//i.test(u) && URL_RE.test(u))) return L3(name, "uses a non-web address (file, ftp \u2026)");
  if (urls.some((u) => /[?#]|@/.test(u))) return L3(`${name} ${short(urls[0])}`, "the address carries extra data (a ? query or login), which could send private text");
  const outFlag = toks.findIndex((t) => ["-o", "--output", "-O", "--output-document", "-outfile", "-OutFile", "--remote-name", "-P", "--directory-prefix"].includes(t));
  const wgetSaves = (name === "wget" && !ps) && !toks.some((t, i) => (t === "-O" || t === "--output-document") && toks[i + 1] === "-") && !/^-[a-zA-Z]*O-$/.test(toks.join(" "));
  if (outFlag >= 0 || wgetSaves || (name === "curl" && !ps && hasShortFlag(args, "O"))) {
    const dest = outFlag >= 0 && toks[outFlag + 1] && !URL_RE.test(toks[outFlag + 1]) && toks[outFlag] !== "-O" && toks[outFlag] !== "--remote-name" ? [toks[outFlag + 1]] : ["."];
    return inFolders(dest, ctx, L2(`download ${short(urls[0])}`, dest[0] === "." ? ["*"] : targets(dest, ctx)));
  }
  return L1(`read ${short(urls[0])}`);
}
function ghCmd(args: Tok[]): Out {
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  const [a, b] = [pos[0] ?? "", pos[1] ?? ""];
  if (hasFlag(args, "bash", "version") || (a === "version")) return L1("show the gh version");
  if (["pr", "issue", "run", "release", "repo", "workflow", "label", "gist", "search", "status", "cache", "ruleset"].includes(a) && ["list", "view", "status", "diff", "checks", ""].includes(b) && !(a === "repo" && b === "") && !hasFlag(args, "bash", "web", "w")) return L1(`look at GitHub (${a}${b ? ` ${b}` : ""})`);
  if (a === "search") return L1("search GitHub");
  if (a === "pr" && b === "checkout") return L2("check out a pull request");
  return L3(`gh ${a} ${b}`.trim(), a === "auth" ? "logs in or shows your GitHub login" : a === "api" ? "can send anything to GitHub" : "changes or posts something on GitHub");
}
function dockerCmd(args: Tok[], ctx: CmdCtx): Out {
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  if (["ps", "images", "version", "info", "logs", "inspect", "stats", "top", "history", "port", "diff", "events"].includes(pos[0])) return L1(`docker ${pos[0]}`);
  if (pos[0] === "build" || (pos[0] === "compose" && pos[1] === "build") || (pos[0] === "buildx" && pos[1] === "build" && !hasFlag(args, "bash", "push"))) return inFolders(["."], ctx, L1("build a container image"));
  return L3(`docker ${pos[0] ?? ""}`.trim(), pos[0] === "push" ? "uploads an image" : pos[0] === "login" ? "logs in" : /^(?:rm|rmi|prune|system|volume|kill|stop)$/.test(pos[0] ?? "") ? "deletes or stops containers" : "runs containers that can reach files and the network");
}
function buildTool(name: string, args: Tok[], ctx: CmdCtx): Out {
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  if (pos.some((p) => /install|deploy|publish|release|upload|clean|uninstall|push/.test(p))) return L3(`${name} ${pos.join(" ")}`, "installs, deletes or publishes");
  return inFolders(["."], ctx, L1(`build with ${name}`));
}
function langTool(name: string, args: Tok[], ctx: CmdCtx): Out {
  const pos = positional(args, "bash").map((a) => a.t.toLowerCase());
  const sub = pos[0] ?? "";
  if (hasFlag(args, "bash", "version", "V") || sub === "version" || sub === "--version") return L1(`show the ${name} version`);
  if (["build", "test", "check", "clippy", "vet", "doc", "bench", "tree", "list", "env", "metadata", "restore"].includes(sub)) return inFolders(["."], ctx, L1(`${name} ${sub}`));
  if (["fmt", "format"].includes(sub)) return inFolders(["."], ctx, hasFlag(args, "bash", "check") ? L1(`check formatting`) : L2(`format code`));
  if (sub === "run") return inFolders(["."], ctx, L2(`run the ${name} program`));
  if (["new", "init"].includes(sub)) return inFolders(pos.slice(1, 2), ctx, L2(`make a new ${name} project`));
  return L3(`${name} ${sub}`.trim(), /install|add|get|publish|login|nuget|tool|clean|yank|owner/.test(sub) ? "installs, publishes or logs in" : `a ${name} action ORBIT doesn't know`);
}

/** Every token that looks like a path (absolute, ~, ..) is checked even when the command is otherwise fine: a commit message can't hide a path, but an argument can. */
function scanTokens(seg: Seg, ctx: CmdCtx): Out | null {
  let hit: Out | null = null;
  for (const w of seg.words.slice(1)) {
    const o = scanToken(w, seg, ctx);
    if (o?.private) return o; // private wins: the output must stay away from models
    hit ??= o;
  }
  return hit;
}
function scanToken(w: Tok, seg: Seg, ctx: CmdCtx): Out | null {
  const name = base(seg.words[0]?.t ?? "");
  {
    const t = w.t;
    if (isFlag(w, ctx.shell)) {
      if (AUTH_FLAG.test(flagName(t)) && !["git"].includes(name)) return L3(name, "uses a password, token or login");
      const eq = t.indexOf("=");
      if (eq < 0) return null;
      const v = t.slice(eq + 1);
      if (!/^(?:[a-z]:)?[\\/~]|^\.\.[\\/]/i.test(v)) return null;
      const p = resolveArg(v, ctx.cwd, ctx.home);
      if (p && (where(p, ctx) === "private" || secretName(p))) return { ...L3(name, where(p, ctx) === "private" ? "touches VAULT, journal or LIFE files: private, so only you see the output" : "touches passwords, keys or login files"), private: where(p, ctx) === "private" };
      return null;
    }
    if (/^hk(?:lm|cu|cr|u|cc)?:|^hkey_|^registry::/i.test(t)) return L3(name, "touches the Windows registry");
    if (/^\\\\|^\/\/[^/]/.test(t)) return L3(name, "uses a network share");
    if (!/^(?:[a-z]:)?[\\/]|^~[\\/]?|^\.\.(?:[\\/]|$)|[\\/]\.\.(?:[\\/]|$)/i.test(t) || URL_RE.test(t)) {
      const p = resolveArg(t, ctx.cwd, ctx.home);
      if (p && secretName(p) && /^[\w.@-]+$/.test(t) && /[._]/.test(t)) return L3(name, "touches passwords, keys or login files");
      return null;
    }
    const p = resolveArg(t, ctx.cwd, ctx.home);
    if (!p) return L3(name, "uses a path ORBIT can't check");
    const wh = where(p, ctx);
    if (wh === "private") return { ...L3(name, "touches VAULT, journal or LIFE files: private, so only you see the output"), private: true };
    if (secretName(p)) return L3(name, "touches passwords, keys or login files");
    if (wh === "system" && !(name === "cd" || NAMES.cd.has(name))) return L3(name, "touches system folders");
  }
  return null;
}

const LEVEL_WORDS: Record<Level, string> = { 1: "runs now", 2: "snapshot first, then runs (Undo kept)", 3: "waits for your OK" };
export const levelWords = (l: Level) => LEVEL_WORDS[l];

/** The verdict for one command line. Never throws. */
export function classifyCommand(command: string, ctx: CmdCtx): CmdVerdict {
  try { return classifyRaw(command, ctx); }
  catch { return { level: 3, what: "run a command", reason: "ORBIT couldn't check it", writes: [], private: false }; }
}
function classifyRaw(command: string, ctx: CmdCtx): CmdVerdict {
  const cwd = normPath(ctx.cwd);
  const fail = (reason: string, priv = false): CmdVerdict => ({ level: 3, what: command.trim().slice(0, 80) || "run a command", reason, writes: [], private: priv });
  if (!cwd) return fail("the session's folder isn't valid");
  const c: CmdCtx = { ...ctx, cwd };
  const cw = where(cwd, c);
  if (cw === "private") return fail("this session is in a private folder (VAULT, journal or LIFE)", true);
  if (cw !== "folder") return fail("this session isn't in one of your connected folders");
  const p = parse(command, ctx.shell);
  if ("bad" in p) return fail(`can't be checked safely: ${p.bad}`);
  const outs: Out[] = [];
  for (let i = 0; i < p.pipes.length; i++) {
    const seg = p.pipes[i];
    const scan = scanTokens(seg, c);
    if (scan) { outs.push({ ...scan, what: stage(seg, c, i === 0).what }); continue; }
    let o = stage(seg, c, i === 0);
    if (i > 0 && o.level === 1 && !isFilter(seg, ctx.shell)) o = { ...o, level: 2, reason: "a piped command that may change files", writes: ["*"] };
    for (const r of seg.redirIn) { const g = inFolders([r], c, o); if (g.level === 3) o = g; }
    for (const r of seg.redirOut) {
      if (/^(?:nul|\/dev\/null)$/i.test(r)) continue;
      const g = inFolders([r], c, L2(`${o.what}, saving to ${short(r)}`, targets([r], c)));
      o = g.level === 3 ? { ...g, what: o.what } : o.level === 3 ? o : { ...g, writes: [...(o.writes ?? []), ...g.writes] };
    }
    outs.push(o);
  }
  const level = Math.max(...outs.map((o) => o.level)) as Level;
  const worst = outs.find((o) => o.level === level)!;
  const what = outs.map((o) => o.what).join(" → ");
  const priv = outs.some((o) => o.private);
  if (level === 2) {
    const writes = [...new Set(outs.flatMap((o) => o.level === 2 ? o.writes : []))];
    if (writes.some((w) => w !== "*" && where(w, c) !== "folder")) return { level: 3, what, reason: "changes files outside your connected folders", writes: [], private: priv };
    if (ctx.outside) return { level: 3, what, reason: "outside text (a page, file or agent result) is in this chat, so changes wait for your OK", writes: [], private: priv };
    return { level, what, reason: worst.reason, writes: writes.length ? writes : ["*"], private: priv };
  }
  return { level, what, reason: worst.reason, writes: [], private: priv };
}
const FILTERS = new Set(["grep", "egrep", "fgrep", "rg", "findstr", "select-string", "sls", "head", "tail", "wc", "sort", "uniq", "cut", "tr", "jq", "column", "nl", "measure-object", "measure",
  "select-object", "select", "sort-object", "format-table", "ft", "format-list", "fl", "out-string", "out-null", "group-object", "where-object", "more", "cat", "type", "sed", "less"]);
const isFilter = (seg: Seg, shell: Shell) => FILTERS.has(base(seg.words[0]?.t ?? "")) && positional(seg.words.slice(1), shell).length <= 1;
