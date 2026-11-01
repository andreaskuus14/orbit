// Pure rules for GAME DEV → Files (Rojo + Selene on his PC): project folder names, the Rojo project file ORBIT writes, and
// Selene's JSON output → issues grouped by file. IO side: rojo.ts. Tests: tests/rojo.test.ts.

export const ROJO_PORT = 34872; // `rojo serve` default
export const MAX_ISSUES = 500;
export const SETUP_HINT = "Run tools\\roblox\\setup.ps1 once (PowerShell, from the ORBIT folder): it installs Rokit, Rojo and Selene.";

/** Where scripts live in a Roblox place. Workspace is left out on purpose: Rojo would then own every part, mesh and the terrain. */
const SERVICES: [string, string][] = [
  ["ReplicatedFirst", "ReplicatedFirst"], ["ReplicatedStorage", "ReplicatedStorage"], ["ServerScriptService", "ServerScriptService"],
  ["ServerStorage", "ServerStorage"], ["StarterGui", "StarterGui"], ["StarterPack", "StarterPack"],
];
const PLAYER: [string, string][] = [["StarterPlayerScripts", "StarterPlayerScripts"], ["StarterCharacterScripts", "StarterCharacterScripts"]];

/** Every folder the project file points at (they must exist before `rojo syncback` / `rojo serve`). */
export const SOURCE_DIRS = [...SERVICES.map(([n]) => `src/${n}`), ...PLAYER.map(([n]) => `src/StarterPlayer/${n}`)];

/** default.project.json. $ignoreUnknownInstances: Rojo never deletes Studio things that aren't in the files (safer while he learns). */
export function projectJson(name: string): string {
  const node = (cls: string, p: string) => ({ $className: cls, $path: p, $ignoreUnknownInstances: true });
  const tree: Record<string, unknown> = { $className: "DataModel" };
  for (const [n, cls] of SERVICES) tree[n] = node(cls, `src/${n}`);
  tree.StarterPlayer = { $className: "StarterPlayer", ...Object.fromEntries(PLAYER.map(([n, cls]) => [n, node(cls, `src/StarterPlayer/${n}`)])) };
  return JSON.stringify({ name, tree }, null, 2) + "\n";
}

export const SELENE_TOML = 'std = "roblox"\n';
export const GITIGNORE = "# Rojo build output and place files (the source of truth is src/)\n*.rbxl\n*.rbxlx\n*.rbxl.lock\n*.rbxlx.lock\nsourcemap.json\n";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Place file path → a folder name that is legal on Windows: no <>:"/\|?* or control characters, no trailing dot/space, no reserved names. */
export function projectName(placeFile: string): string {
  const base = placeFile.split(/[\\/]/).pop() ?? "";
  const n = base.replace(/\.rbxlx?$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60).trim();
  return !n || RESERVED.test(n) ? `place-${n || "untitled"}` : n;
}

/** A place file path he typed or pasted ("Copy as path" adds quotes). Null when it isn't a .rbxl/.rbxlx path. */
export function placePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim().replace(/^"(.*)"$/, "$1").trim();
  return p.length < 1000 && /\.rbxlx?$/i.test(p) && !/[\x00-\x1f]/.test(p) ? p : null;
}

export type Issue = { line: number; col: number; severity: "error" | "warning"; code: string; message: string; text?: string };
export type FileIssues = { file: string; issues: Issue[] };
export type Lint = { files: FileIssues[]; errors: number; warnings: number; parseErrors: number; total: number; clipped: boolean };

/** "./src\\X.luau" → "src/X.luau" (Selene prints paths the way it found them). */
export const cleanFile = (f: string) => f.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

/** `selene --display-style json2` stdout (one JSON object per line) → issues by file. Selene's lines/columns are 0-based; ours are 1-based.
 *  Non-JSON lines are skipped. Null when nothing in it was Selene output (e.g. a crash message). */
export function parseSelene(stdout: string): Lint | null {
  const byFile = new Map<string, Issue[]>();
  let seen = false, summary: { errors: number; warnings: number; parseErrors: number } | null = null, total = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "Summary") {
      seen = true;
      const n = (k: string) => (Number.isFinite(j[k]) ? Number(j[k]) : 0);
      summary = { errors: n("errors"), warnings: n("warnings"), parseErrors: n("parse_errors") };
      continue;
    }
    if (j.type !== undefined && j.type !== "Diagnostic") continue; // json2 tags every line; plain json has no type
    const label = j.primary_label as { filename?: unknown; span?: { start_line?: unknown; start_column?: unknown } } | undefined;
    if (typeof j.message !== "string" || !label || typeof label.filename !== "string") continue;
    seen = true;
    total++;
    const file = cleanFile(label.filename), list = byFile.get(file) ?? [];
    if (total > MAX_ISSUES) continue;
    const num = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) + 1 : 1);
    list.push({
      line: num(label.span?.start_line), col: num(label.span?.start_column),
      severity: String(j.severity).toLowerCase() === "error" ? "error" : "warning",
      code: typeof j.code === "string" ? j.code.slice(0, 60) : "", message: j.message.slice(0, 500),
    });
    byFile.set(file, list);
  }
  if (!seen) return null;
  const all = [...byFile.values()].flat();
  const files = [...byFile].map(([file, issues]) => ({ file, issues: issues.sort((a, b) => a.line - b.line || a.col - b.col) }))
    .sort((a, b) => a.file.localeCompare(b.file));
  return {
    files, total,
    errors: summary?.errors ?? all.filter((i) => i.severity === "error").length,
    warnings: summary?.warnings ?? all.filter((i) => i.severity === "warning").length,
    parseErrors: summary?.parseErrors ?? all.filter((i) => i.code === "parse_error").length,
    clipped: total > MAX_ISSUES,
  };
}

/** The text CORE gets: counts, then up to `max` issues as file:line [code] message (errors first). */
export function lintSummary(project: string, r: Lint, max = 25): string {
  if (!r.total) return `Selene found no issues in "${project}".`;
  const rows = r.files.flatMap((f) => f.issues.map((i) => ({ f: f.file, i })))
    .sort((a, b) => (a.i.severity === b.i.severity ? 0 : a.i.severity === "error" ? -1 : 1));
  const head = `Selene found ${r.total} issue${r.total === 1 ? "" : "s"} in "${project}" (${r.errors} error${r.errors === 1 ? "" : "s"}, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}${r.parseErrors ? `, ${r.parseErrors} file(s) that don't parse` : ""}) across ${r.files.length} file${r.files.length === 1 ? "" : "s"}:`;
  const lines = rows.slice(0, max).map(({ f, i }) => `- ${f}:${i.line} ${i.severity}${i.code ? ` [${i.code}]` : ""}: ${i.message}${i.text ? ` | ${i.text.trim().slice(0, 120)}` : ""}`);
  return [head, ...lines, ...(rows.length > max ? [`(${rows.length - max} more in GAME DEV → Build → Files)`] : [])].join("\n");
}
