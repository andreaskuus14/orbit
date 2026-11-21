// Night-shift self-repair: the HARD protected-path list and the diff checks (pure, tested in tests/night-repair-protect.test.ts).
// A night patch is rejected as a whole when any file it touches is outside the allowed folders or matches a protected rule, when a
// test is deleted or weakened, or when added lines reach for processes, the network from tests, credentials or skipped checks.
// Checked on the real `git diff` of the night branch (numstat + raw + patch), not on what the agent says it changed, both before the
// gate runs and again when the owner taps Approve. This file and its test are themselves protected, so a patch can't loosen them.
// Ideas taken from the parked self-dev PRs (#417 supervisor/policy.ts: allow+deny lists, Windows aliases, modes, weakened tests).
import { checkDiff } from "./self-improve-patch-pure.ts";

/** Only these folders may change at all. */
export const ALLOW_PREFIXES = ["src/", "tests/", "docs/"] as const;

/** Protected prefixes/files (compared case-insensitively: the laptop's NTFS checkout is case-insensitive). */
export const PROTECTED_PREFIXES = [
  "scripts/", // launch.ps1 (supervisor + watchdog), stop.ps1, night/wake tasks, secret-scan, eval:ai runner
  ".github/", ".claude/", ".husky/", "AGENTS.md", "CLAUDE.md", "README.md",
  "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "restart-orbit.cmd", "supabase/", "evals/",
  "src/middleware.ts", "src/instrumentation.ts", "src/lib/supabase/", "src/lib/self-update.ts", "src/lib/claude.ts", "src/lib/scheduler.ts",
  "src/app/api/auth/", "src/app/login/", "src/app/api/health/", "src/app/api/system/", "src/app/api/stop-all/", "src/app/api/remote/",
  "src/app/api/night-repair/", "src/app/api/autonomy/",
  // Files `npm run eval:ai` (part of the gate) loads into its own process: a change there could report the eval as passed.
  "src/lib/memory-retrieval-pure.ts", "src/lib/agent-scorecard-pure.ts", "src/lib/pure.ts", "src/lib/passages.ts",
] as const;

/** Protected by name anywhere under src/ and tests/ (the guard tests carry the same words, so they are covered too). */
export const PROTECTED_RULES: readonly [RegExp, string][] = [
  [/night-repair/i, "the night repair itself (incl. this protected-path list)"],
  [/self-improve-patch/i, "the patch safety checker"],
  [/approv|polic|autonom|authority|stop-?all|allow-once|(^|\/)allow\.ts$|csrf|(^|\/)remote(-act|-web-pure|-pure)?\.ts$|scheduler-gate|usage-(pace|meter)|agent-defs|route-guards/i, "approval, policy, autonomy, Stop-all, gate or pacer code"],
  [/journal|(^|\/)private-pure|(^|\/)(core-|galaxy-)?life[\w-]*\.tsx?$|privacy|memory-scope|failure-report|task-output-guard/i, "the journal/LIFE privacy guard"],
  [/auth|session|(^|\/)pair|token|secret|crypto|vapid/i, "auth, sessions or secrets"],
  [/(^|\/)\.env|\.(pem|key|pfx|p12)$/i, "a secrets file"],
  [/send|mail|invoice|stripe|pay(ment)?|money|publish|upload|negotiat|resend|ntfy|push/i, "payment or send/publish code"],
  [/watchdog|heartbeat|crash-log/i, "the watchdog"],
  [/red-?team/i, "the red-team self-attack suite (a patch must fix the hole, never the expected outcome)"],
  [/(^|\/)\.git/i, "git metadata"],
];

export const LIMITS = { maxFiles: 8, maxLines: 400 } as const;

/** Names Windows resolves to another file than they say: 8.3 short names, trailing dot/space, streams, device names. */
export function windowsAlias(p: string): string {
  for (const part of p.split("/")) {
    if (/~\d/.test(part)) return "looks like a Windows short name (8.3)";
    if (/[. ]$/.test(part)) return "ends in a dot or space (Windows drops it)";
    if (/[:<>|"?*\\\x00-\x1f]/.test(part)) return "has a character Windows treats specially";
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) return "is a Windows device name";
  }
  return "";
}

/** Why a repo-relative path may not be changed by a night patch, or "" when it may. */
export function protectedPath(raw: string): string {
  const p = String(raw ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p || p.startsWith("/") || /^[a-z]:/i.test(p) || p.split("/").includes("..")) return `unsafe path "${p}"`;
  const alias = windowsAlias(p);
  if (alias) return `${p}: ${alias}`;
  const lc = p.toLowerCase();
  const pre = PROTECTED_PREFIXES.find((x) => { const y = x.toLowerCase(); return lc === y || (y.endsWith("/") && lc.startsWith(y)); });
  if (pre) return `${p}: protected (${pre})`;
  const rule = PROTECTED_RULES.find(([re]) => re.test(p));
  if (rule) return `${p}: protected (${rule[1]})`;
  if (!ALLOW_PREFIXES.some((a) => lc.startsWith(a))) return `${p}: outside the folders a night patch may change (${ALLOW_PREFIXES.join(", ")})`;
  return "";
}

export type FileChange = { path: string; added: number; removed: number };

/** `git diff --numstat` → changes; binary files count as large; a rename gives both paths. */
export function parseNumstat(text: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
    if (!m) continue;
    const n = (s: string) => (s === "-" ? 1000 : Number(s));
    for (const path of expandRename(m[3])) out.push({ path, added: n(m[1]), removed: n(m[2]) });
  }
  return out;
}
function expandRename(s: string): string[] {
  if (!s.includes(" => ")) return [s];
  const b = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(s);
  if (b) return [`${b[1]}${b[2]}${b[4]}`.replace("//", "/"), `${b[1]}${b[3]}${b[4]}`.replace("//", "/")];
  return s.split(" => ");
}

/** `git diff --raw --no-renames` → links, submodules, odd modes, git metadata, changed existing fixtures. */
export function modeViolations(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^:(\d{6}) (\d{6}) \S+ \S+ ([A-Z])\d*\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, from, to, status, file] = m;
    for (const mode of [from, to]) if (mode !== "000000" && mode !== "100644" && mode !== "100755") out.push(`${file}: file mode ${mode} (links and submodules aren't allowed)`);
    if (/^tests\/fixtures\//i.test(file) && status !== "A") out.push(`${file}: existing test fixture changed`);
  }
  return out;
}

const isTest = (p: string) => /(^|\/)tests\//i.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(p);
// Added lines anywhere: credentials, skipped checks, turning typechecking off.
const DANGER_ANY: [RegExp, string][] = [
  [/[\\/.]ssh[\\/]|\.claude[\\/]|\.aws[\\/]|credentials\.json|id_(rsa|ed25519)|\.git-credentials/i, "reads credential files"],
  [/@ts-nocheck|eslint-disable(?!-next-line)/, "switches checks off for a file"],
  [/process\.env\.(?!NODE_ENV\b)[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|COOKIE)/, "reads a secret from the environment"],
];
// Tests are code the gate runs on the owner's account: no processes, no network, no ending the run early.
const DANGER_TEST: [RegExp, string][] = [
  [/child_process|\b(execSync|spawnSync|execFile|spawn)\s*\(|\bprocess\.(exit|kill|abort)\b/, "spawns processes or exits"],
  [/\bfetch\s*\(|node:(http|https|net|dgram|tls)\b|["'](http|https|net|dgram|tls)["']|WebSocket\s*\(/, "uses the network"],
  [/\borbitDataDir\b|LOCALAPPDATA|homedir\s*\(/, "touches the owner's data folder"],
];

/** Every reason this night patch must be rejected as a whole ([] = it may go to the gate). numstat/raw/patch: from `git diff base..head`. */
export function checkPatch(d: { numstat: string; raw: string; patch: string }): string[] {
  const why: string[] = [];
  const files = parseNumstat(d.numstat);
  if (!files.length) return ["the agent changed nothing"];
  if (files.length > LIMITS.maxFiles) why.push(`${files.length} files changed (limit ${LIMITS.maxFiles})`);
  const lines = files.reduce((n, f) => n + f.added + f.removed, 0);
  if (lines > LIMITS.maxLines) why.push(`${lines} changed lines (limit ${LIMITS.maxLines})`);
  for (const f of files) { const w = protectedPath(f.path); if (w) why.push(w); }
  why.push(...modeViolations(d.raw));
  if (/^GIT binary patch|^Binary files /m.test(d.patch)) why.push("contains a binary file");
  // The shared patch checker (deleted/weakened tests, removed guards, skips, git writes, permission bypass, "adds no test assertion").
  why.push(...checkDiff(d.patch).filter((w) => !/^touches /.test(w))); // its path rules are a subset of protectedPath above
  for (const chunk of d.patch.replace(/\r\n/g, "\n").split(/^diff --git /m).slice(1)) {
    const name = /^a\/(\S+) b\/(\S+)/.exec(chunk)?.[2] ?? "?";
    const added = chunk.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    for (const [re, what] of DANGER_ANY) if (added.some((l) => re.test(l))) why.push(`${name}: ${what}`);
    if (isTest(name)) for (const [re, what] of DANGER_TEST) if (added.some((l) => re.test(l))) why.push(`${name}: test ${what}`);
  }
  return [...new Set(why)];
}
