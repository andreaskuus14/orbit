// GAME DEV → Files, live sync half (pure): a connected project folder's default.project.json, the exact command lines ORBIT runs
// (rojo serve on loopback, rojo build, StyLua, Selene), StyLua's JSON output, the "check before sync" verdict, Rojo's status in
// plain words, which file paths CORE may write, and which git commit an Undo reverts. IO: rojo.ts. Tests: tests/rojo-sync.test.ts.
import { ROJO_PORT, cleanFile, type Lint } from "./rojo-pure.ts";
import { et } from "./et-ask-pure.ts";

export const PROJECT_FILE = "default.project.json";
export const LOOPBACK = "127.0.0.1";
/** StyLua defaults for a folder that has no StyLua config yet. Roblox's own style uses tabs; Luau syntax so type annotations parse. */
export const STYLUA_TOML = 'syntax = "Luau"\ncolumn_width = 120\nindent_type = "Tabs"\nquote_style = "AutoPreferDouble"\n';
export const STYLUA_CONFIGS = ["stylua.toml", ".stylua.toml"];
export const EDIT_PREFIX = "ORBIT edit: ";
export const SNAPSHOT_MSG = "Snapshot of your own changes (before an ORBIT edit)";
export const MAX_FILE_CHARS = 200_000;

/* ---------- command lines (fixed arguments, no shell) ---------- */

/** Always loopback and the fixed port, even if the project file asks for serveAddress 0.0.0.0: nothing on the LAN can reach it. */
export const serveArgs = (port = ROJO_PORT) => ["serve", PROJECT_FILE, "--address", LOOPBACK, "--port", String(port)];
export const buildArgs = (out: string) => ["build", PROJECT_FILE, "--output", out];
export const seleneArgs = (targets: string[]) => ["--display-style", "json2", ...targets];
export const styluaCheckArgs = (targets: string[]) => ["--check", "--output-format=json", ...targets];
export const styluaFormatArgs = (targets: string[]) => ["--", ...targets];

/** backups/<project>-2026-11-21-1405.rbxl (local time parts given by the caller, so tests don't depend on the time zone). */
export function backupFile(project: string, d: { y: number; mo: number; d: number; h: number; mi: number }): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const safe = project.replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "-").slice(0, 40) || "place";
  return `backups/${safe}-${d.y}-${p(d.mo)}-${p(d.d)}-${p(d.h)}${p(d.mi)}.rbxl`;
}

/* ---------- default.project.json ---------- */

export type ProjectFile = { name: string; paths: string[]; problems: string[] };
const badRel = (p: string) => !p || /^[\\/]|^[a-z]:/i.test(p) || p.split(/[\\/]/).includes("..") || /[\x00-\x1f]/.test(p);

/** Read a Rojo project file: its name, every $path in the tree (posix, "./" stripped), and plain-word problems.
 *  Null when it isn't JSON with a tree. A $path outside the folder is listed as a problem and left out. */
export function readProjectFile(text: string): ProjectFile | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { return null; }
  if (!j || typeof j !== "object" || !j.tree || typeof j.tree !== "object") return null;
  const paths: string[] = [], problems: string[] = [];
  const walk = (n: Record<string, unknown>, depth: number) => {
    if (depth > 30) return;
    for (const [k, v] of Object.entries(n)) {
      if (k === "$path") {
        const raw = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { optional?: unknown }).optional === "string" ? (v as { optional: string }).optional : "";
        const p = cleanFile(raw).replace(/\/+$/, "");
        if (badRel(p)) problems.push(`A $path points outside the project folder ("${raw.slice(0, 80)}"). ORBIT ignores it.`);
        else if (!paths.includes(p)) paths.push(p);
      } else if (!k.startsWith("$") && v && typeof v === "object") walk(v as Record<string, unknown>, depth + 1);
    }
  };
  walk(j.tree as Record<string, unknown>, 0);
  if (!paths.length) problems.push("The project file doesn't point at any script folder ($path), so there is nothing to sync.");
  const addr = typeof j.serveAddress === "string" ? j.serveAddress : "";
  if (addr && addr !== LOOPBACK && addr !== "localhost") problems.push(`The project file asks Rojo to listen on ${addr}. ORBIT always uses ${LOOPBACK} (this PC only).`);
  return { name: typeof j.name === "string" && j.name.trim() ? j.name.trim().slice(0, 80) : "project", paths, problems };
}

/** What Selene and StyLua look at: the first folder of each $path (src/ServerScriptService → src), sorted. */
export function lintTargets(paths: string[]): string[] {
  return [...new Set(paths.map((p) => p.split("/")[0]).filter(Boolean))].sort();
}

/* ---------- which folders may be connected ---------- */

const norm = (p: string, win: boolean) => { const s = p.replace(/\\/g, "/").replace(/\/+$/, ""); return win ? s.toLowerCase() : s; };
/** Why a folder can't be connected, or "". Refused: not absolute, a drive root, the home folder itself, ORBIT's own folder (or
 *  anything inside it), and system folders. */
export function connectRefusal(dir: string, o: { home: string; orbit: string; win: boolean }): string {
  const d = dir.trim();
  if (!d || d.length > 400 || /[\x00-\x1f]/.test(d)) return "Give the full path of a folder.";
  if (!(o.win ? /^[a-z]:[\\/]/i.test(d) || /^\\\\/.test(d) : d.startsWith("/"))) return "Give the full path of a folder (for example C:\\Users\\you\\Documents\\PetSim).";
  const n = norm(d, o.win), home = norm(o.home, o.win), orbit = norm(o.orbit, o.win);
  if (/^[a-z]:$/i.test(n) || n === "" || n === "/") return "Pick a project folder, not a whole drive.";
  if (n === home) return "Pick a project folder, not your whole user folder.";
  if (n === orbit || n.startsWith(orbit + "/")) return "That is ORBIT's own folder. Pick your game's folder.";
  if (/^[a-z]:\/(windows|program files( \(x86\))?|programdata)(\/|$)/i.test(n) || /^\/(etc|bin|sbin|usr|proc|sys|dev|boot)(\/|$)/.test(n)) return "That is a system folder. Pick your game's folder.";
  return "";
}

/** Saved connected folders (JSON) → unique absolute paths, at most 20. Damaged = empty. */
export function parseConnected(raw: string | null): string[] {
  try {
    const j = JSON.parse(raw ?? "");
    const list = Array.isArray(j?.dirs) ? j.dirs.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length < 400) : [];
    return [...new Set<string>(list.map((x: string) => x.trim()))].slice(0, 20);
  } catch { return []; }
}

export type Proj = { name: string; dir: string; at: string; connected?: boolean };
/** Exported projects first-class, then connected folders; a connected folder whose name is taken gets " (2)", " (3)"… */
export function mergeProjects(exported: Proj[], connected: Proj[]): Proj[] {
  const taken = new Set(exported.map((p) => p.name.toLowerCase()));
  const seenDir = new Set(exported.map((p) => p.dir.toLowerCase()));
  const out = [...exported];
  for (const c of connected) {
    if (seenDir.has(c.dir.toLowerCase())) continue;
    seenDir.add(c.dir.toLowerCase());
    let name = c.name, i = 2;
    while (taken.has(name.toLowerCase())) name = `${c.name} (${i++})`;
    taken.add(name.toLowerCase());
    out.push({ ...c, name, connected: true });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------- which files CORE may read / write ---------- */

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** A Luau file path CORE gave → "src/ServerScriptService/Coins.server.luau", or null. Must sit inside one of the project's $path
 *  folders (or be one of its file $paths), end in .luau/.lua, and hold no "..", drive letters, ":" or names Windows can't store. */
export function scriptPath(raw: unknown, paths: string[]): string | null {
  if (typeof raw !== "string") return null;
  const p = cleanFile(raw.trim()).replace(/\/{2,}/g, "/");
  if (p.length > 260 || badRel(p) || p.includes(":") || !/\.luau?$/i.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || /[<>"|?*]/.test(s) || /[. ]$/.test(s) || RESERVED.test(s))) return null;
  return paths.some((root) => p === root || p.startsWith(root + "/")) ? p : null;
}

/** Rojo's naming: what kind of script a file becomes in Studio. */
export function scriptKind(file: string): "Script" | "LocalScript" | "ModuleScript" {
  const base = file.split("/").pop()!.toLowerCase();
  return /\.server\.luau?$/.test(base) ? "Script" : /\.client\.luau?$/.test(base) ? "LocalScript" : "ModuleScript";
}

/* ---------- StyLua --check --output-format=json ---------- */

export type StyleParse = { file: string; line: number; col: number; message: string };
export type Style = { unformatted: string[]; parseErrors: StyleParse[]; other: string };

/** Every top-level JSON value in a text (StyLua prints objects per line on stdout, and arrays back to back on stderr). */
export function jsonValues(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"' && depth > 0) { inStr = true; continue; }
    if (c === "{" || c === "[") { if (depth++ === 0) start = i; }
    else if ((c === "}" || c === "]") && depth > 0 && --depth === 0) {
      try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not JSON: skip */ }
    }
  }
  return out;
}

/** StyLua's output → unformatted files and parse errors (StyLua's lines are 1-based already). Null when it says nothing usable and
 *  failed (exit 2 with plain text = a crash or a bad option: `other` would be empty). */
export function parseStylua(stdout: string, stderr: string, code: number | null): Style | null {
  const unformatted: string[] = [], parseErrors: StyleParse[] = [];
  for (const v of jsonValues(stdout)) {
    const f = (v as { file?: unknown })?.file;
    if (typeof f === "string" && !unformatted.includes(cleanFile(f))) unformatted.push(cleanFile(f));
  }
  for (const v of jsonValues(stderr)) {
    for (const e of Array.isArray(v) ? v : [v]) {
      const o = e as { type?: unknown; message?: unknown; filename?: unknown; location?: { start_line?: unknown; start_column?: unknown } };
      if (o?.type !== "parse_error" || typeof o.message !== "string") continue;
      const n = (x: unknown) => (Number.isInteger(x) && (x as number) > 0 ? (x as number) : 1);
      parseErrors.push({ file: cleanFile(String(o.filename ?? "")), line: n(o.location?.start_line), col: n(o.location?.start_column), message: o.message.slice(0, 300) });
    }
  }
  const other = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("[") && !l.startsWith("{")).join(" ").slice(0, 400);
  if (code === 2 && !parseErrors.length && !unformatted.length) return other ? { unformatted, parseErrors, other } : null;
  return { unformatted: unformatted.sort(), parseErrors, other: code === 0 || code === 1 ? "" : other };
}

/* ---------- the check before sync, in plain words ---------- */

const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export type Verdict = { blocking: boolean; text: string; rows: string[] };
/** Selene errors and code that doesn't parse block sync (Studio would get broken scripts); warnings and formatting don't. */
export function checkVerdict(lint: Lint, style: Style | null): Verdict {
  const errs = lint.files.flatMap((f) => f.issues.filter((i) => i.severity === "error").map((i) => `${f.file} line ${i.line}: ${i.message}`));
  const parse = (style?.parseErrors ?? []).map((e) => `${e.file} line ${e.line}: the code doesn't read as Luau (${e.message})`);
  const rows = [...new Set([...errs, ...parse])];
  const bits: string[] = [];
  if (rows.length) bits.push(`${pl(rows.length, "mistake")} to fix before syncing`);
  if (lint.warnings) bits.push(`${pl(lint.warnings, "hint")} (they don't stop sync)`);
  if (style?.unformatted.length) bits.push(`${pl(style.unformatted.length, "file")} not tidy (press Format code)`);
  if (!style) bits.push("StyLua didn't run, so tidiness wasn't checked");
  const text = bits.length ? `Code check: ${bits.join(", ")}.` : "Code check: no mistakes found and the code is tidy.";
  return { blocking: rows.length > 0, text, rows: rows.slice(0, 20) };
}

/* ---------- Rojo's status in plain words ---------- */

/** A crash or refusal in `rojo serve`'s output → one plain sentence, or "". */
export function explainRojoLog(log: string): string {
  const l = log.toLowerCase();
  if (/address already in use|only one usage of each socket address|os error 10048|os error 98\b/.test(l)) return `Port ${ROJO_PORT} is already taken by another program. Close the other Rojo window and try again.`;
  if (/(couldn't|could not|unable to|failed to) (find|locate|open).{0,40}project|no project file|is not a (rojo )?project/.test(l)) return `Rojo can't find ${PROJECT_FILE} in that folder. Connect the folder again so ORBIT can make one.`;
  if (/project.{0,60}(invalid|error|expected|unknown field|parse)|json|serde/.test(l)) return `${PROJECT_FILE} has a mistake in it, so Rojo stopped. ${lastErrorLine(log)}`.trim();
  if (/permission denied|access is denied|os error 5\b/.test(l)) return "Rojo wasn't allowed to read a file in the project (Windows said access denied).";
  const e = lastErrorLine(log);
  return e ? `Rojo stopped: ${e}` : "";
}
function lastErrorLine(log: string): string {
  const lines = log.split(/\r?\n/).map((s) => s.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean);
  const e = [...lines].reverse().find((s) => /error|panick|failed/i.test(s));
  return e ? e.replace(/^\[?error\]?:?\s*/i, "").slice(0, 200) : "";
}

/** A MessagePack string value right after the key `key` (fixstr / str8 / str16), or null. Enough for Rojo's flat info map. */
function msgpackStr(buf: Uint8Array, key: string): string | null {
  const k = new TextEncoder().encode(key);
  outer: for (let i = 1; i + k.length < buf.length; i++) {
    for (let j = 0; j < k.length; j++) if (buf[i + j] !== k[j]) continue outer;
    if (buf[i - 1] !== (0xa0 | k.length)) continue; // the key itself must be a fixstr of that length
    let p = i + k.length, len = -1;
    const h = buf[p++];
    if (h >= 0xa0 && h <= 0xbf) len = h & 0x1f;
    else if (h === 0xd9) len = buf[p++];
    else if (h === 0xda) { len = (buf[p] << 8) | buf[p + 1]; p += 2; }
    if (len < 0 || p + len > buf.length) return null;
    return new TextDecoder().decode(buf.subarray(p, p + len));
  }
  return null;
}
/** GET /api/rojo on the running server (MessagePack since Rojo 7.5, JSON before) → its project name and version, or null when it
 *  isn't Rojo. */
export function parseRojoInfo(body: Uint8Array | string): { project: string; version: string } | null {
  const buf = typeof body === "string" ? new TextEncoder().encode(body) : body;
  try {
    const j = JSON.parse(new TextDecoder().decode(buf));
    if (typeof j?.serverVersion !== "string" || typeof j?.sessionId !== "string") return null;
    return { project: typeof j.projectName === "string" ? j.projectName.slice(0, 80) : "", version: j.serverVersion.slice(0, 20) };
  } catch { /* not JSON: MessagePack */ }
  const version = msgpackStr(buf, "serverVersion");
  if (!version || !msgpackStr(buf, "sessionId")) return null;
  return { project: (msgpackStr(buf, "projectName") ?? "").slice(0, 80), version: version.slice(0, 20) };
}

export type ServeState = "off" | "starting" | "on" | "outside" | "stopped";
/** One plain sentence for GAME DEV → Files and CORE. `lastExit` = the log of a rojo serve that ended by itself. */
export function serveWords(s: { running: boolean; ours: string | null; info: { project: string; version: string } | null; lastExit?: string }): { state: ServeState; text: string } {
  if (s.ours && s.running) return { state: "on", text: `Live sync is on for "${s.ours}"${s.info ? ` (Rojo ${s.info.version})` : ""}. In Studio: Plugins → Rojo → Connect. Saved files then show up in Studio right away.` };
  if (s.ours) return { state: "starting", text: "Live sync is starting…" };
  if (s.running) return { state: "outside", text: `Rojo is already running outside ORBIT${s.info?.project ? ` for "${s.info.project}"` : ""} (port ${ROJO_PORT}). ORBIT didn't start it, so it can't stop it: close that window.` };
  const why = s.lastExit ? explainRojoLog(s.lastExit) : "";
  return why ? { state: "stopped", text: `Live sync stopped by itself. ${why}` } : { state: "off", text: "Live sync is off." };
}

/* ---------- git: snapshots and undo ---------- */

export type Commit = { hash: string; subject: string };
/** `git log --format=%H%x1f%s` → commits, newest first. */
export const parseLog = (out: string): Commit[] =>
  out.split(/\r?\n/).map((l) => l.split("\x1f")).filter((p) => p.length >= 2 && /^[0-9a-f]{7,64}$/.test(p[0])).map(([hash, ...s]) => ({ hash, subject: s.join("\x1f").slice(0, 200) }));

export const undoSubject = (c: Commit) => `Undo ORBIT edit ${c.hash.slice(0, 10)}: ${c.subject.slice(EDIT_PREFIX.length)}`.slice(0, 200);
/** The newest ORBIT edit that hasn't been undone yet (his own commits and snapshots are never picked), or null. */
export function pickUndo(log: Commit[]): Commit | null {
  const undone = new Set<string>();
  for (const c of log) {
    const m = /^Undo ORBIT edit ([0-9a-f]{7,64})/.exec(c.subject);
    if (m) { undone.add(m[1]); continue; }
    if (c.subject.startsWith(EDIT_PREFIX) && ![...undone].some((u) => c.hash.startsWith(u))) return c;
  }
  return null;
}

/* ---------- CORE's explicit ask ---------- */

// Script files can hold other people's code (free models, copied modules), so a write or undo needs HIS latest message to ask for a
// code change: text inside a file never counts. EN + ET.
const ASK_EN = /\b(?:fix|change|edit|write|rewrite|add|make|create|update|refactor|rename|remove|delete|tidy|format|clean|improve|implement|undo|revert|roll ?back|put back|apply)\b/i;
const ASK_ET = et("paranda|muuda|kirjuta|lisa|tee |loo |uuenda|eemalda|kustuta|korrasta|vorminda|parenda|võta tagasi|tühista|ennista");
/** Why a roblox_write / roblox_undo is refused, or "". */
export function robloxWriteBlocked(question: string): string {
  return ASK_EN.test(question) || ASK_ET.test(question) ? "" : "change his script files only when his latest message asks for a code change (or an undo)";
}
