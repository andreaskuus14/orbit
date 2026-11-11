// ARCH daylight study (pure, tested in tests/arch-daylight.test.ts). A teaching estimate, not a certified daylight calculation:
// rooms are found by flood-filling each floor's wall plan; a room's direct sun is sampled every hour of the 21st of each month and
// ray-tested against the model's own blocks (walls, slabs, roof as boxes; no trees, no terrain, no reflected light).
import { isOpening, isStraightWall, RULES, type Face, type Part } from "./arch-pure.ts";
import { wallRects, type Rect } from "./arch-walk-pure.ts";
import { sunDirection } from "./sun-pure.ts";

export type Room = { id: string; name: string; floor: number; y: number; h: number; area: number; rects: Rect[]; windows: string[]; glazing: number };
export type Window = { id: string; room: string; x: number; y: number; z: number; w: number; h: number; face: Face };
export type Plan = { rooms: Room[]; windows: Window[]; boxes: Box[] };
export type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
export type Site = { lat: number; lon: number };
/** One month's 21st, sampled each solar hour (h + 0.5): sun above the horizon, and per room whether any window sees it. */
export type MonthSample = { up: boolean[]; lit: Record<string, boolean[]> };

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const OUT: Record<Face, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }; // outward normal (x, z); n = −Z
const MAX_CELLS = 200_000;

/** Rooms per floor: walls of one floor (same base height) rasterised on a grid; every enclosed region not reachable from outside
 *  is a room. Doors don't connect rooms (a room is what the walls enclose). Windows join the room on their inner side when their
 *  outer side is outdoors; glass between two rooms is ignored. shortcut: area is in grid cells (~0.2 m), fine for a teaching estimate. */
export function daylightPlan(parts: Part[]): Plan {
  const walls = parts.filter((p) => p.kind === "wall");
  const levels = [...new Set(walls.map((w) => Math.round(w.y * 10) / 10))].sort((a, b) => a - b);
  const rooms: Room[] = [], windows: Window[] = [];
  levels.forEach((ly) => {
    const floor = rooms.reduce((m, r) => Math.max(m, r.floor), 0); // count only levels that enclose rooms (a garden wall is no floor)
    const lw = walls.filter((w) => Math.round(w.y * 10) / 10 === ly);
    const rects = wallRects(lw.map((w) => ({ ...w, y: 0 }))); // all walls, no door gaps
    const x0 = Math.min(...rects.map((r) => r.x0)), x1 = Math.max(...rects.map((r) => r.x1));
    const z0 = Math.min(...rects.map((r) => r.z0)), z1 = Math.max(...rects.map((r) => r.z1));
    const c = Math.max(0.2, Math.sqrt(((x1 - x0) * (z1 - z0)) / MAX_CELLS));
    const nx = Math.ceil((x1 - x0) / c) + 2, nz = Math.ceil((z1 - z0) / c) + 2, gx = x0 - c, gz = z0 - c;
    const grid = new Int32Array(nx * nz); // 0 open, -1 wall, -2 outdoors, k > 0 room k
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = gx + i * c, b = gz + j * c; // a cell touched by any wall is wall, so thin walls never leak
      if (rects.some((r) => r.x0 < a + c && r.x1 > a && r.z0 < b + c && r.z1 > b)) grid[j * nx + i] = -1;
    }
    const fill = (start: number, v: number) => {
      const st = [start]; grid[start] = v; let n = 0;
      while (st.length) {
        const k = st.pop()!, i = k % nx, j = (k - i) / nx; n++;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj, kk = jj * nx + ii;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && grid[kk] === 0) { grid[kk] = v; st.push(kk); }
        }
      }
      return n;
    };
    fill(0, -2); // corner cell is always open margin
    const h = Math.max(...lw.map((w) => w.h)), at = (x: number, z: number) => {
      const i = Math.floor((x - gx) / c), j = Math.floor((z - gz) / c);
      return i < 0 || j < 0 || i >= nx || j >= nz ? -2 : grid[j * nx + i];
    };
    const mine: Room[] = [];
    for (let k = 0; k < grid.length; k++) if (grid[k] === 0) {
      const id = mine.length + 1, n = fill(k, id);
      mine.push({ id: `f${floor + 1}r${id}`, name: "", floor: floor + 1, y: ly, h, area: Math.round(n * c * c * 10) / 10, rects: cellRects(grid, nx, nz, id, gx, gz, c), windows: [], glazing: 0 });
    }
    // name rooms north → south, then west → east, so names stay put while he edits
    const centre = (r: Room) => r.rects.reduce((s, q) => s + (q.z0 + q.z1) / 2 * (q.x1 - q.x0) * (q.z1 - q.z0), 0) / Math.max(1e-9, r.area);
    [...mine].sort((a, b) => centre(a) - centre(b)).forEach((r, i) => { r.name = `Floor ${floor + 1} · room ${String.fromCharCode(65 + (i % 26))}`; });
    for (const o of parts) {
      const host = lw.find((w) => w.id === o.host);
      if (o.kind !== "window" || !host || !o.face) continue;
      const [ox, oz] = OUT[o.face], t = isStraightWall(host) ? Math.min(host.w, host.d) : RULES.wallThick, s = 1.5 * c;
      const inside = at(o.x - ox * (t + s), o.z - oz * (t + s)), outside = at(o.x + ox * s, o.z + oz * s);
      const room = inside > 0 && outside === -2 ? mine[inside - 1] : undefined; // mine is indexed by fill id before the sort
      if (!room) continue;
      room.windows.push(o.id); room.glazing = Math.round((room.glazing + o.w * o.h) * 100) / 100;
      windows.push({ id: o.id, room: room.id, x: o.x, y: o.y, z: o.z, w: o.w, h: o.h, face: o.face });
    }
    rooms.push(...mine);
  });
  const boxes = parts.filter((p) => !isOpening(p.kind) && p.kind !== "prop").map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y, y1: p.y + p.h, z0: p.z - p.d / 2, z1: p.z + p.d / 2 }));
  return { rooms: rooms.sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name)), windows, boxes };
}

/** Room cells → rectangles: runs along x per row, merged down while the next row has the same run. */
function cellRects(grid: Int32Array, nx: number, nz: number, v: number, gx: number, gz: number, c: number): Rect[] {
  const open = new Map<string, Rect>(), out: Rect[] = [];
  for (let j = 0; j < nz; j++) {
    const seen = new Set<string>();
    for (let i = 0; i < nx; i++) {
      if (grid[j * nx + i] !== v) continue;
      let e = i; while (e + 1 < nx && grid[j * nx + e + 1] === v) e++;
      const key = `${i}:${e}`, r = open.get(key);
      if (r) r.z1 = gz + (j + 1) * c; else open.set(key, { x0: gx + i * c, x1: gx + (e + 1) * c, z0: gz + j * c, z1: gz + (j + 1) * c });
      seen.add(key); i = e;
    }
    for (const [k, r] of open) if (!seen.has(k)) { out.push(r); open.delete(k); }
  }
  return [...out, ...open.values()];
}

/** Slab test: does the ray o + t·d (t > 0) hit the box? */
export function rayHitsBox(o: [number, number, number], d: [number, number, number], b: Box): boolean {
  let lo = 1e-6, hi = Infinity;
  const mins = [b.x0, b.y0, b.z0], maxs = [b.x1, b.y1, b.z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) { if (o[a] <= mins[a] || o[a] >= maxs[a]) return false; continue; }
    let t0 = (mins[a] - o[a]) / d[a], t1 = (maxs[a] - o[a]) / d[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    if (lo >= hi) return false;
  }
  return true;
}

/** Does direct sun (unit vector toward it: +x east, +y up, −z north) reach any of 5 points on the window (centre + inset corners)? */
export function windowSees(win: Window, sun: { x: number; y: number; z: number }, boxes: Box[]): boolean {
  const [ox, oz] = OUT[win.face];
  if (sun.y <= 0 || sun.x * ox + sun.z * oz <= 0) return false; // below the horizon or behind the wall
  const tx = -oz, tz = ox, d: [number, number, number] = [sun.x, sun.y, sun.z];
  return [[0, 0.5], [-0.4, 0.1], [0.4, 0.1], [-0.4, 0.9], [0.4, 0.9]].some(([u, v]) => {
    const o: [number, number, number] = [win.x + tx * u * win.w + ox * 0.02, win.y + v * win.h, win.z + tz * u * win.w + oz * 0.02];
    return !boxes.some((b) => rayHitsBox(o, d, b));
  });
}

/** ARC05: the study's inputs, shown and editable in the panel. day = sampled day of each month; step = minutes between samples;
 *  dfDiv = the daylight-factor rule DF ≈ window-to-floor ratio ÷ dfDiv. */
export type DaylightInputs = { day: number; stepMin: number; year: number; dfDiv: number };
export const DAYLIGHT_INPUTS: DaylightInputs = { day: 21, stepMin: 60, year: 2025, dfDiv: 5 };
export const DAYLIGHT_RANGE: Record<keyof DaylightInputs, [number, number]> = { day: [1, 28], stepMin: [15, 120], year: [1900, 2100], dfDiv: [3, 10] };
export function cleanDaylight(raw: unknown): DaylightInputs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(DAYLIGHT_INPUTS).map(([k, d]) => {
    const v = Number(o[k]), [lo, hi] = DAYLIGHT_RANGE[k as keyof DaylightInputs];
    return [k, o[k] !== undefined && o[k] !== "" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, k === "dfDiv" ? v : Math.round(v))) : d];
  })) as DaylightInputs;
}

/** One chunk of work: day `day` of `month` (0–11), every `stepMin` of local solar time (UTC + lon/15), so the strip reads noon = sun south. */
export function studyMonth(plan: Plan, site: Site, month: number, year = 2025, day = 21, stepMin = 60): MonthSample {
  const up: boolean[] = [], lit: Record<string, boolean[]> = Object.fromEntries(plan.rooms.map((r) => [r.id, [] as boolean[]]));
  for (let k = 0, n = Math.round((24 * 60) / stepMin); k < n; k++) {
    const h = (k * stepMin) / 60, sun = sunDirection(site.lat, site.lon, new Date(Date.UTC(year, month, day) + (h + stepMin / 120 - site.lon / 15) * 3_600_000));
    up.push(sun.y > 0);
    for (const r of plan.rooms) lit[r.id].push(sun.y > 0 && plan.windows.some((w) => w.room === r.id && windowSees(w, sun, plan.boxes)));
  }
  return { up, lit };
}

export type RoomResult = { id: string; name: string; annualHours: number; decHours: number; junHours: number; wfr: number; df: number; noDecSun: boolean };
/** Annual direct-sun hours weight each sampled day by its month's length. Daylight factor rule of thumb: DF ≈ window-to-floor
 *  ratio ÷ 5 (the BRE average-DF formula with a typical room: glass transmittance 0.7, 80° of sky, mean reflectance 0.5). */
export function summarize(plan: Plan, months: MonthSample[], stepMin = 60, dfDiv = 5): RoomResult[] {
  return plan.rooms.map((r) => {
    const hours = months.map((m) => Math.round(((m.lit[r.id]?.filter(Boolean).length ?? 0) * stepMin) / 6) / 10);
    const wfr = r.area > 0 ? r.glazing / r.area : 0;
    return { id: r.id, name: r.name, annualHours: Math.round(hours.reduce((s, n, i) => s + n * MONTH_DAYS[i], 0)), decHours: hours[11] ?? 0, junHours: hours[5] ?? 0,
      wfr: Math.round(wfr * 1000) / 10, df: Math.round((wfr * 1000) / dfDiv) / 10, noDecSun: months.length === 12 && hours[11] === 0 };
  });
}

/** What the DF band means for a learner (CIBSE/BRE-style bands). */
export const dfBand = (df: number) => (df < 2 ? "dim: lights on most of the day" : df < 5 ? "good daylight" : "very bright: check glare and overheating");
