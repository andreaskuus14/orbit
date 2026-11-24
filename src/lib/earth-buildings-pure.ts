// "Planet Earth" phase 2: OSM 3D buildings for city close-ups. Tile maths (one z14 tile ≈ 1.2 km at Tallinn), the Overpass query,
// parsing Overpass JSON into footprints with heights (height / building:levels / a default), the GPU cap, and extrusion into
// plain arrays (walls + ear-clipped roofs) the scene turns into one mesh per tile. Pure; tests/earth-buildings.test.ts.
// Data: © OpenStreetMap contributors, ODbL. Fetched only on the laptop server (/api/earth/buildings), cached per tile on disk.
import { lat2y, lon2x, x2lon, y2lat, toXYZ, type Box } from "./earth-pure.ts";

export const BZ = 14;
/** Buildings show only below this altitude (km). */
export const BUILDINGS_MAX_ALT = 25;
/** GPU budget (RTX 5060 Laptop): at most this many buildings per tile and in the whole scene. */
export const PER_TILE = 1500, TOTAL = 12000;

export const tileBox = (x: number, y: number, z = BZ): Box => ({ w: x2lon(x, z), e: x2lon(x + 1, z), n: y2lat(y, z), s: y2lat(y + 1, z) });
export const validBTile = (x: number, y: number) => [x, y].every(Number.isInteger) && x >= 0 && y >= 0 && x < 2 ** BZ && y < 2 ** BZ;

/** z14 tiles to load around a look point: a radius that grows with altitude (1.5–6 km), nearest first, at most `max`. */
export function tilesAround(lon: number, lat: number, alt: number, max = 25): { x: number; y: number }[] {
  if (alt > BUILDINGS_MAX_ALT) return [];
  const rKm = Math.max(1.5, Math.min(6, 1 + alt * 0.4));
  const fx = lon2x(lon, BZ), fy = lat2y(lat, BZ), kmPerTile = (40075 * Math.cos((lat * Math.PI) / 180)) / 2 ** BZ;
  const r = Math.ceil(rKm / kmPerTile), out: { x: number; y: number; d: number }[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor(fx) + dx, y = Math.floor(fy) + dy;
    const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy) * kmPerTile;
    if (d <= rKm + kmPerTile * 0.71 && validBTile(x, y)) out.push({ x, y, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max).map(({ x, y }) => ({ x, y }));
}

/** The Overpass QL for one tile: building ways with their geometry (relations/multipolygons are skipped: rare, heavy). */
export function overpassQuery(b: Box): string {
  const f = (n: number) => n.toFixed(6);
  return `[out:json][timeout:25];way["building"](${f(b.s)},${f(b.w)},${f(b.n)},${f(b.e)});out tags geom;`;
}

export type Building = { r: [number, number][]; h: number; min: number };
const num = (s: string | undefined) => { if (!s) return NaN; const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?/i.exec(s); if (!m) return NaN; const v = Number(m[1].replace(",", ".")); return m[2] && /ft|'/i.test(m[2]) ? v * 0.3048 : v; };
/** Height in metres from OSM tags: height, else building:levels × 3 m (+ roof levels), else a default by building type. */
export function heightOf(t: Record<string, string>): { h: number; min: number } {
  const lv = num(t["building:levels"]), rl = num(t["roof:levels"]);
  let h = num(t.height);
  if (!(h > 0)) h = lv > 0 ? lv * 3 + (rl > 0 ? rl * 2 : 1) : ({ house: 7, detached: 7, garage: 3, garages: 3, shed: 3, hut: 3, church: 18, cathedral: 30, apartments: 15, commercial: 12, industrial: 9, retail: 8 } as Record<string, number>)[t.building] ?? 8;
  let min = num(t.min_height);
  if (!(min >= 0)) { const ml = num(t["building:min_level"]); min = ml > 0 ? ml * 3 : 0; }
  h = Math.max(2, Math.min(h, 400));
  return { h, min: Math.min(Math.max(0, min), h - 1) };
}
const area = (r: [number, number][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };

type OverpassEl = { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };
/** Overpass JSON → footprints (closed rings, counter-clockwise, no repeated last point) with heights. Junk is dropped. */
export function parseOverpass(j: { elements?: OverpassEl[] } | null | undefined): Building[] {
  const out: Building[] = [];
  for (const el of j?.elements ?? []) {
    if (el.type !== "way" || !el.tags?.building || !el.geometry || el.geometry.length < 4) continue;
    if (el.tags.building === "roof" || el.tags.location === "underground" || el.tags.layer?.startsWith("-")) continue;
    let r = el.geometry.map((g) => [Math.round(g.lon * 1e7) / 1e7, Math.round(g.lat * 1e7) / 1e7] as [number, number]);
    const [a, z] = [r[0], r[r.length - 1]];
    if (a[0] !== z[0] || a[1] !== z[1]) continue; // not closed
    r = r.slice(0, -1).filter((p, i, s) => i === 0 || p[0] !== s[i - 1][0] || p[1] !== s[i - 1][1]);
    if (r.length < 3 || r.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    const ar = area(r);
    if (Math.abs(ar) < 1e-10) continue;
    if (ar < 0) r.reverse();
    out.push({ r, ...heightOf(el.tags) });
  }
  return out;
}
/** Keep the GPU in budget: the biggest buildings (footprint × height) first. */
export function capBuildings(b: Building[], n = PER_TILE): Building[] {
  if (b.length <= n) return b;
  return b.map((x) => ({ x, k: Math.abs(area(x.r)) * Math.sqrt(x.h) })).sort((p, q) => q.k - p.k).slice(0, n).map((p) => p.x);
}

/** Ear clipping for a simple counter-clockwise polygon (2D, any units). Triangle indices into pts. */
export function earcut2(pts: [number, number][]): number[] {
  const n = pts.length, idx = Array.from({ length: n }, (_, i) => i), tris: number[] = [];
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: number[], a: number[], b: number[], c: number[]) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = n * n + 10;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 0) continue; // reflex
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && inside(pts[k], a, b, c))) continue;
      tris.push(ia, ib, ic); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break; // self-touching ring: fan the rest
  }
  for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
  return tris;
}

export type Extruded = { origin: [number, number, number]; positions: Float32Array; normals: Float32Array; shade: Float32Array; wall: Float32Array; index: Uint32Array; count: number };
const M = 6371000;
/** Walls and flat roofs for a tile's buildings, as positions relative to `origin` (the tile centre on the unit sphere, so float32
 *  stays precise to centimetres). baseAt(lon, lat) = ground height in metres in the scene (terrain exaggeration and lift included);
 *  walls go `sink` metres below it so no gap shows on slopes. shade: 0 = wall bottom … 1 = roof (the shader uses it for colour).
 *  wall: per vertex [metres along the wall, metres above the ground, the building's height] (real metres) for windows and tint. */
export function extrude(bs: Building[], center: { lon: number; lat: number }, baseAt: (lon: number, lat: number) => number = () => 0, hScale = 1, sink = 12): Extruded {
  const o = toXYZ(center.lon, center.lat);
  const P: number[] = [], N: number[] = [], S: number[] = [], W: number[] = [], I: number[] = [];
  const kx = Math.cos((center.lat * Math.PI) / 180);
  const put = (lon: number, lat: number, hm: number, n: [number, number, number], s: number, w: [number, number, number]) => {
    const p = toXYZ(lon, lat, hm / M); P.push(p[0] - o[0], p[1] - o[1], p[2] - o[2]); N.push(...n); S.push(s); W.push(...w); return P.length / 3 - 1;
  };
  for (const b of bs) {
    const cx = b.r.reduce((s, p) => s + p[0], 0) / b.r.length, cy = b.r.reduce((s, p) => s + p[1], 0) / b.r.length;
    const g = baseAt(cx, cy), lo = g + b.min * hScale - (b.min > 0 ? 0 : sink), hi = g + b.h * hScale;
    const up = toXYZ(cx, cy) as [number, number, number];
    const e: [number, number, number] = [Math.cos((cx * Math.PI) / 180), 0, -Math.sin((cx * Math.PI) / 180)]; // east
    const nn: [number, number, number] = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2], up[0] * e[1] - up[1] * e[0]]; // north = up × east
    const H = b.h * hScale, L = lo - g; // wall coordinates in real metres (before exaggeration) for the window pattern
    let run = 0;
    for (let i = 0; i < b.r.length; i++) {
      const a = b.r[i], c = b.r[(i + 1) % b.r.length];
      const dx = (c[0] - a[0]) * kx, dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1, lm = l * 111320;
      const ox = dy / l, oy = -dx / l; // outward for a CCW ring
      const n: [number, number, number] = [e[0] * ox + nn[0] * oy, e[1] * ox + nn[1] * oy, e[2] * ox + nn[2] * oy];
      const v0 = put(a[0], a[1], lo, n, 0, [run, L / hScale, b.h]), v1 = put(c[0], c[1], lo, n, 0, [run + lm, L / hScale, b.h]);
      const v2 = put(c[0], c[1], hi, n, 0.85, [run + lm, H / hScale, b.h]), v3 = put(a[0], a[1], hi, n, 0.85, [run, H / hScale, b.h]);
      I.push(v0, v1, v2, v0, v2, v3); run += lm;
    }
    const base = P.length / 3;
    for (const p of b.r) put(p[0], p[1], hi, up, 1, [0, b.h, b.h]);
    for (const t of earcut2(b.r.map((p) => [p[0] * kx, p[1]]))) I.push(base + t);
  }
  return { origin: o, positions: new Float32Array(P), normals: new Float32Array(N), shade: new Float32Array(S), wall: new Float32Array(W), index: new Uint32Array(I), count: bs.length };
}
