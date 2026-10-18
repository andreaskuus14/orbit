// DevWorld → Tron Grid: the owner's Roblox scripts as a neon city. Pure parsing + layout (tested in tests/grid.test.ts).
// Data: a script list the owner prints with a read-only Studio command-bar line (GRID_SNIPPET) and pastes here,
// plus console errors from the Playtest bot's last run (or pasted). ORBIT never writes into Studio for this.

export const GRID_SCRIPTS_KEY = "orbit.grid.scripts";
export const GRID_ERRORS_KEY = "orbit.grid.errors";
export const MAX_SCRIPTS = 2000;
export const MAX_ERRORS = 200;

/** Read-only: prints "<full path> <line count>" for every script in the usual services. Nothing is changed. */
export const GRID_SNIPPET = `for _, svc in {workspace, game.ServerScriptService, game.ReplicatedStorage, game.ReplicatedFirst, game.ServerStorage, game.StarterPlayer, game.StarterGui, game.StarterPack} do for _, s in svc:GetDescendants() do if s:IsA("LuaSourceContainer") then local ok, src = pcall(function() return s.Source end) if ok then print(s:GetFullName(), select(2, src:gsub("\\n", "")) + 1) end end end end`;

export type Script = { path: string; name: string; lines: number; district: string; errors: string[] };
export type Building = { script: Script; x: number; z: number; h: number };
export type District = { name: string; x: number; z: number; w: number; d: number; count: number };
export type GridLayout = { buildings: Building[]; districts: District[]; size: number; maxLines: number };

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
const noGame = (p: string) => p.replace(/^game\./, "");

/** Pasted Output lines → unique scripts. Tolerates Studio's "12:00:01.234  " prefix and "  -  Edit" suffix; junk lines are skipped. */
export function parseScriptList(text: string): { path: string; lines: number }[] {
  const seen = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const l = clean(raw.slice(0, 400)).replace(/^\d{1,2}:\d{2}:\d{2}(\.\d+)?\s+/, "").replace(/\s+-\s+(Edit|Server|Client|Studio|Plugin)\b.*$/i, "");
    const m = /^(.+?)[\s,\t]+(\d{1,7})$/.exec(l);
    if (!m) continue;
    const path = noGame(m[1]).slice(0, 300);
    if (!path || !/^[A-Za-z_]/.test(path)) continue;
    if (!seen.has(path)) seen.set(path, Math.min(Number(m[2]), 1_000_000));
    if (seen.size >= MAX_SCRIPTS) break;
  }
  return [...seen].map(([path, lines]) => ({ path, lines }));
}

/** Service, or "Service.Folder" when the script sits deeper. */
export function districtOf(path: string): string {
  const parts = path.split(".");
  return parts.length > 2 ? `${parts[0]}.${parts[1]}` : parts[0];
}

/** Each error line goes to the script whose path it names (longest match, followed by ":" "'" "," space or end). */
export function attachErrors(list: { path: string; lines: number }[], errorText: string): Script[] {
  const scripts: Script[] = list.map((s) => ({ ...s, name: s.path.split(".").pop() || s.path, district: districtOf(s.path), errors: [] }));
  const byLen = [...scripts].sort((a, b) => b.path.length - a.path.length);
  const lines = errorText.split(/\r?\n/).map((l) => clean(l).slice(0, 300)).filter(Boolean).slice(0, MAX_ERRORS);
  for (const line of lines) {
    const hit = byLen.find((s) => { const i = line.indexOf(s.path); return i >= 0 && /^($|[:',\s])/.test(line.slice(i + s.path.length)) && (i === 0 || /[^\w.]/.test(line[i - 1])); });
    if (hit && !hit.errors.includes(line)) hit.errors.push(line);
  }
  return scripts;
}

const CELL = 1, STREET = 1.6;
/** Monotonic in lines; sqrt so one huge script doesn't flatten the rest. */
export const heightFor = (lines: number, maxLines: number) => 0.2 + 6 * Math.sqrt(Math.max(0, lines) / Math.max(1, maxLines));

/** Districts (sorted by name) are square blocks packed in rows; buildings fill each block tallest first. Centered on the origin. */
export function layoutGrid(scripts: Script[]): GridLayout {
  const maxLines = scripts.reduce((m, s) => Math.max(m, s.lines), 0);
  const groups = new Map<string, Script[]>();
  for (const s of scripts) groups.set(s.district, [...(groups.get(s.district) ?? []), s]);
  const names = [...groups.keys()].sort();
  const sides = names.map((n) => Math.ceil(Math.sqrt(groups.get(n)!.length)) * CELL);
  const rowMax = Math.max(sides[0] ?? 0, Math.sqrt(sides.reduce((a, s) => a + (s + STREET) ** 2, 0)));
  const districts: District[] = [], buildings: Building[] = [];
  let x = 0, z = 0, rowD = 0;
  names.forEach((name, i) => {
    const side = sides[i];
    if (x > 0 && x + side > rowMax) { x = 0; z += rowD + STREET; rowD = 0; }
    const list = [...groups.get(name)!].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
    const cols = Math.round(side / CELL);
    list.forEach((s, k) => buildings.push({ script: s, x: x + (k % cols + 0.5) * CELL, z: z + (Math.floor(k / cols) + 0.5) * CELL, h: heightFor(s.lines, maxLines) }));
    districts.push({ name, x, z, w: side, d: side, count: list.length });
    x += side + STREET; rowD = Math.max(rowD, side);
  });
  const w = Math.max(0, ...districts.map((d) => d.x + d.w)), d = Math.max(0, ...districts.map((q) => q.z + q.d));
  for (const b of buildings) { b.x -= w / 2; b.z -= d / 2; }
  for (const q of districts) { q.x -= w / 2; q.z -= d / 2; }
  return { buildings, districts, size: Math.max(w, d), maxLines };
}
