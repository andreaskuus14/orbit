// GAME DEV → automatic Selene check after a Rojo export, pure half: Selene's JSON → flat findings, a stable fingerprint per finding (file +
// rule + normalised message, never line numbers, so moving code doesn't re-file a bug), the diff against the game's backlog, backlog drafts
// and the summary text. IO (finding selene, running it, saving): selene.ts. Tests: tests/selene.test.ts.
// Noise: the exported project's selene.toml (rojo-pure SELENE_TOML) already allows the taste rule multiple_statements; warnings are only shown.
import { parseSelene } from "./rojo-pure.ts";
import type { Draft } from "./backlog-pure.ts";
import type { Bug } from "./devworld-pure.ts";

export type Finding = { file: string; line: number; col: number; severity: "error" | "warning"; code: string; message: string };
export const MAX_FILED_PER_RUN = 10; // new backlog bugs from one run; the rest are counted, not filed
export const REF_PREFIX = "selene:";
export const INSTALL_HINT = "Selene isn't installed, so the code check was skipped. Install it with Rokit (rokit add Kampfkarren/selene) or Aftman (aftman add Kampfkarren/selene), or run tools\\roblox\\setup.ps1; set ORBIT_SELENE to its full path if it lives somewhere else.";

/** `selene --display-style json2|json` stdout → findings (errors first, then by file/line). Null when it held no Selene output at all. */
export function parseFindings(stdout: string): Finding[] | null {
  const lint = parseSelene(stdout);
  if (!lint) return null;
  const all = lint.files.flatMap((f) => f.issues.map((i): Finding => ({ file: f.file, line: i.line, col: i.col, severity: i.severity, code: i.code, message: i.message })));
  return all.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error") || a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
}

/** Message with the parts that drift between runs removed: numbers ("line 12", "3 times"), whitespace, case. Identifier names stay. */
export const normalizeMessage = (m: string) => m.toLowerCase().replace(/\bline\s+\d+\b/g, "line").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** cyrb53: small, deterministic, no dependency (this is dedupe, not security). */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
/** 12 hex chars from file + code + normalised message. */
export const fingerprint = (f: Pick<Finding, "file" | "code" | "message">) => hash(`${f.file.replace(/\\/g, "/").toLowerCase()}\u0000${f.code}\u0000${normalizeMessage(f.message)}`).slice(0, 12);
/** What a backlog bug stores in `ref` (the field is capped at 40 characters). */
export const refOf = (f: Pick<Finding, "file" | "code" | "message">) => `${REF_PREFIX}${fingerprint(f)}`;

export type Diff = { fresh: Finding[]; known: number; overflow: number };
/** Error-level findings not yet in the game's backlog. Open/fixing bugs and wontfix ones suppress a finding (he decided to leave it);
 *  a bug marked fixed does not, so a regression is filed again. One entry per fingerprint, capped at `cap`. */
export function newErrors(findings: Finding[], bugs: Pick<Bug, "game" | "ref" | "status">[], gameId: string, cap = MAX_FILED_PER_RUN): Diff {
  const have = new Set(bugs.filter((b) => b.game === gameId && b.ref?.startsWith(REF_PREFIX) && b.status !== "fixed").map((b) => b.ref));
  const seen = new Set<string>();
  const fresh: Finding[] = [];
  let known = 0, overflow = 0;
  for (const f of findings) {
    if (f.severity !== "error") continue;
    const ref = refOf(f);
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (have.has(ref)) known++;
    else if (fresh.length < cap) fresh.push(f);
    else overflow++;
  }
  return { fresh, known, overflow };
}

/** One backlog draft per finding: a bug, priority medium, severity major (a file that doesn't parse is a crash). */
export function draftFor(f: Finding): Draft {
  const title = `Selene${f.code ? ` ${f.code}` : ""}: ${f.message} (${f.file.split("/").pop()})`.replace(/\s+/g, " ").slice(0, 140);
  return {
    title, kind: "bug", priority: "medium", status: "open", ref: refOf(f),
    severity: f.code === "parse_error" ? "crash" : "major",
    detail: `${f.file}:${f.line}:${f.col} [${f.code || "error"}] ${f.message}. Found by Selene after a Rojo export. Fix it in Studio; the next export checks again.`.slice(0, 2000),
  };
}

export type Counts = { errors: number; warnings: number; files: number };
export const countFindings = (fs: Finding[]): Counts => ({
  errors: fs.filter((f) => f.severity === "error").length, warnings: fs.filter((f) => f.severity === "warning").length, files: new Set(fs.map((f) => f.file)).size,
});

const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const row = (f: Finding) => `${f.file}:${f.line} ${f.severity}${f.code ? ` [${f.code}]` : ""}: ${f.message}`;
/** "Selene: 2 errors, 5 warnings in 3 files · 1 new bug filed (1 already known)", then up to `max` rows (errors first). Warnings are shown, never filed. */
export function summaryText(project: string, fs: Finding[], d: { filed: number; known: number; overflow: number; unfiled?: string }, max = 8): string {
  const c = countFindings(fs);
  if (!fs.length) return `Selene: no issues in "${project}".`;
  const bits = [`${pl(c.errors, "error")}, ${pl(c.warnings, "warning")} in ${pl(c.files, "file")}`];
  if (d.filed) bits.push(`${pl(d.filed, "new bug")} filed`);
  if (d.known) bits.push(`${d.known} already in the backlog`);
  if (d.overflow) bits.push(`${d.overflow} more errors not filed (cap ${MAX_FILED_PER_RUN} per run)`);
  if (d.unfiled) bits.push(d.unfiled);
  const rows = fs.slice(0, max).map((f) => `- ${row(f)}`);
  return [`Selene: ${bits.join(" · ")}`, ...rows, ...(fs.length > max ? [`(${fs.length - max} more in GAME DEV → Build → Files)`] : [])].join("\n");
}

export type Skip = "no-files" | "missing" | "failed";
export type SeleneRun = { status: "ok"; findings: Finding[]; truncated?: boolean } | { status: Skip; hint: string };

/** Where selene may live, in order: ORBIT_SELENE, tool-manager shim folders (rokit, aftman, foreman), the project's own, then PATH. */
export function seleneCandidates(o: { env?: string; home: string; win: boolean; projectDir: string; path: string; sep: string }): string[] {
  const exe = o.win ? "selene.exe" : "selene", j = (...p: string[]) => p.join(o.win ? "\\" : "/");
  const dirs = [j(o.home, ".rokit", "bin"), j(o.home, ".aftman", "bin"), j(o.home, ".foreman", "bin"), j(o.projectDir, ".rokit", "bin"), j(o.projectDir, ".aftman", "bin"), j(o.projectDir, ".foreman", "bin"), ...o.path.split(o.sep).filter(Boolean)];
  return [...(o.env?.trim() ? [o.env.trim()] : []), ...dirs.map((d) => j(d, exe))].filter((p, i, a) => a.indexOf(p) === i);
}
