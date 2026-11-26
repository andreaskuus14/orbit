// Estonia close-up from the Estonian Land Board's open data (Maa- ja Ruumiamet, free with credit "Maa- ja Ruumiamet <year>"):
// LOD2 3D buildings (real roof shapes, laser-scanned heights) and the orthophoto. Pure maths only: L-EST97 <-> WGS84, which
// tiles to load, CityGML -> merged per-tile mesh, and the small binary format the server sends. Used by
// /api/earth/ee3d (server) and src/components/earth/earth-ee3d.ts (three.js layer).
import { ShapeUtils, Vector2 } from "three";
import { MIN_ALT, lat2y, lon2x, x2lon, y2lat } from "./earth-pure.ts";
import { EE3D_MUNIS } from "./earth-ee3d-munis.ts";

/** Building tiles are Web Mercator z15 (about 630 x 630 m at 59° N). */
export const EZ = 15;
/** The layer shows below this camera altitude (km) and is fully on below EE_FULL. */
export const EE_MAX_ALT = 4, EE_FULL = 2.5;
/** GPU budget (RTX 5060 Laptop, 1440p): triangles in the whole layer, tiles kept, orthophoto texels. */
export const TRI_BUDGET = 3_000_000, MAX_TILES = 25, SHARP_TILES = 9;
export const ATTRIBUTION = `3D buildings and orthophoto © Maa- ja Ruumiamet ${new Date().getFullYear()}`;
export const ORTHO_URL = (z: number, x: number, y: number) => `https://tiles.maaamet.ee/tm/wmts/1.0.0/foto/default/GMC/${z}/${y}/${x}.jpg`;
export const LOD2_URL = (muni: string) => `https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&andmetyyp=hooned_lod2&dl=1&page_id=837&f=${encodeURIComponent(`hooned_lod2-${muni}-citygml.zip`)}`;
const R = 6371000; // the scene's sphere radius in metres

/* ---------- L-EST97 (EPSG:3301): Lambert conformal conic, 2 standard parallels, GRS80 ---------- */
const A = 6378137, F = 1 / 298.257222101, E2 = 2 * F - F * F, E = Math.sqrt(E2), D = Math.PI / 180;
const P1 = 58 * D, P2 = (59 + 20 / 60) * D, P0 = (57 + 31 / 60 + 3.19415 / 3600) * D, L0 = 24 * D, FE = 500000, FN = 6375000;
const mF = (p: number) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const tF = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const N_ = (Math.log(mF(P1)) - Math.log(mF(P2))) / (Math.log(tF(P1)) - Math.log(tF(P2)));
const F_ = mF(P1) / (N_ * tF(P1) ** N_), R0 = A * F_ * tF(P0) ** N_;
/** WGS84 lon/lat -> L-EST97 [northing, easting]. */
export function toLest(lon: number, lat: number): [number, number] {
  const r = A * F_ * tF(lat * D) ** N_, th = N_ * (lon * D - L0);
  return [FN + R0 - r * Math.cos(th), FE + r * Math.sin(th)];
}
/** L-EST97 northing, easting -> WGS84 [lon, lat]. */
export function fromLest(n: number, e: number): [number, number] {
  const dx = e - FE, dy = R0 - (n - FN), r = Math.sign(N_) * Math.hypot(dx, dy), t = (r / (A * F_)) ** (1 / N_), th = Math.atan2(dx, dy);
  let p = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 6; i++) p = Math.PI / 2 - 2 * Math.atan(t * ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2));
  return [(th / N_ + L0) / D, p / D];
}

/* ---------- tiles ---------- */
export type ETile = { x: number; y: number };
export const tileCentre = (x: number, y: number) => ({ lon: x2lon(x + 0.5, EZ), lat: y2lat(y + 0.5, EZ) });
export const tileMetres = (lat: number) => (40075016.7 * Math.cos(lat * D)) / 2 ** EZ;
/** Municipalities whose LOD2 file can hold buildings of tile x,y (their bounding boxes touch the tile). */
export function munisFor(x: number, y: number): string[] {
  const c = [toLest(x2lon(x, EZ), y2lat(y, EZ)), toLest(x2lon(x + 1, EZ), y2lat(y, EZ)), toLest(x2lon(x, EZ), y2lat(y + 1, EZ)), toLest(x2lon(x + 1, EZ), y2lat(y + 1, EZ))];
  const n0 = Math.min(...c.map((p) => p[0])), n1 = Math.max(...c.map((p) => p[0])), e0 = Math.min(...c.map((p) => p[1])), e1 = Math.max(...c.map((p) => p[1]));
  return EE3D_MUNIS.filter(([, b]) => b[0] <= n1 && b[2] >= n0 && b[1] <= e1 && b[3] >= e0).map(([m]) => m);
}
/** True where the Land Board has 3D buildings (inside some municipality's box: all of mainland Estonia and the islands). */
export const inEstonia = (lon: number, lat: number) => lon > 21.6 && lon < 28.3 && lat > 57.45 && lat < 59.85 && munisFor(Math.floor(lon2x(lon, EZ)), Math.floor(lat2y(lat, EZ))).length > 0;
export const validETile = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && munisFor(x, y).length > 0 && x >= 0 && y >= 0 && x < 2 ** EZ && y < 2 ** EZ;

/** Tiles to show around the camera target, nearest first, each with its orthophoto zoom (18 ≈ 0.3 m/px near, 17 farther out). */
export function eeTilesAround(lon: number, lat: number, alt: number): (ETile & { z: number; d: number })[] {
  if (alt > EE_MAX_ALT) return [];
  const fx = lon2x(lon, EZ), fy = lat2y(lat, EZ), km = tileMetres(lat) / 1000;
  const rT = Math.min(2.5, Math.max(1.2, (0.6 + alt * 0.9) / km)); // radius in tiles
  const out: (ETile & { z: number; d: number })[] = [];
  for (let y = Math.floor(fy - rT); y <= Math.floor(fy + rT); y++) for (let x = Math.floor(fx - rT); x <= Math.floor(fx + rT); x++) {
    const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
    if (d <= rT + 0.71 && validETile(x, y)) out.push({ x, y, d, z: 17 });
  }
  out.sort((a, b) => a.d - b.d);
  out.slice(0, alt < 0.8 ? SHARP_TILES : alt < 1.6 ? 4 : 1).forEach((t) => (t.z = 18));
  return out.slice(0, MAX_TILES);
}
/** Keeps the nearest tiles whose triangles fit the budget. */
export function withinBudget<T extends { tris: number }>(nearestFirst: T[], budget = TRI_BUDGET): T[] {
  const out: T[] = []; let s = 0;
  for (const t of nearestFirst) { if (s + t.tris > budget) break; s += t.tris; out.push(t); }
  return out;
}

/* ---------- CityGML -> mesh ---------- */
export type Bld = { id: string; rings: number[][][] }; // per polygon: [exterior, ...holes], each ring flat [n, e, h, ...] (L-EST97)
const num = (s: string) => s.trim().split(/\s+/).map(Number);
/** Pulls the buildings out of a piece of CityGML text that holds whole <bldg:Building> elements. */
export function parseBuildings(xml: string): Bld[] {
  const out: Bld[] = [];
  for (const m of xml.matchAll(/<bldg:Building\b[^>]*gml:id="([^"]*)"[^>]*>([\s\S]*?)<\/bldg:Building>/g)) {
    const rings: number[][][] = [];
    for (const p of m[2].matchAll(/<gml:Polygon\b[^>]*>([\s\S]*?)<\/gml:Polygon>/g)) {
      const ext = /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]*)</.exec(p[1]);
      if (!ext) continue;
      const holes = [...p[1].matchAll(/<gml:interior>[\s\S]*?<gml:posList[^>]*>([^<]*)</g)].map((h) => num(h[1]));
      rings.push([num(ext[1]), ...holes]);
    }
    if (rings.length) out.push({ id: m[1], rings });
  }
  return out;
}
/** Splits streamed text into whole buildings: returns the complete part and keeps the tail for the next chunk. */
export function splitBuildings(buf: string): [string, string] {
  const k = buf.lastIndexOf("</bldg:Building>");
  return k < 0 ? ["", buf] : [buf.slice(0, k + 16), buf.slice(k + 16)];
}
/** The z15 tile a building belongs to (by the middle of its points), so every building is in exactly one tile. */
export function tileOf(b: Bld): ETile {
  let n = 0, e = 0, c = 0;
  for (const p of b.rings) { const r = p[0]; for (let i = 0; i < r.length; i += 3) { n += r[i]; e += r[i + 1]; c++; } }
  const [lon, lat] = fromLest(n / c, e / c);
  return { x: Math.floor(lon2x(lon, EZ)), y: Math.floor(lat2y(lat, EZ)) };
}

export type EMesh = { lon: number; lat: number; nB: number; bld: Float32Array /* cx, cy, base per building */; bStart: Uint32Array; pos: Float32Array; nrm: Int8Array /* nx ny nz kind */; idx: Uint32Array };
export const tris = (m: EMesh) => m.idx.length / 3;
/**
 * One merged mesh for the buildings of tile x,y, in metres east / north of the tile centre, height above each building's own
 * lowest point (the scene stands each building on its ground). Flat shaded: every face has its own vertices. kind 1 = roof
 * (faces turned more than ~15° up), 0 = wall. Faces that look down (floors) are left out.
 */
export function buildMesh(bs: Bld[], x: number, y: number): EMesh {
  const { lon, lat } = tileCentre(x, y), kx = D * R * Math.cos(lat * D), ky = D * R;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], bld: number[] = [], bStart: number[] = [];
  for (const b of bs) {
    let base = Infinity, sx = 0, sy = 0, c = 0;
    const local = b.rings.map((rs) => rs.map((r) => {
      const o: number[] = [];
      for (let i = 0; i + 2 < r.length; i += 3) {
        const [lo, la] = fromLest(r[i], r[i + 1]), ex = (lo - lon) * kx, ny = (la - lat) * ky, h = r[i + 2];
        const L = o.length; if (L && Math.abs(o[L - 3] - ex) < 0.01 && Math.abs(o[L - 2] - ny) < 0.01 && Math.abs(o[L - 1] - h) < 0.01) continue;
        o.push(ex, ny, h); base = Math.min(base, h); sx += ex; sy += ny; c++;
      }
      const L = o.length; if (L > 6 && Math.abs(o[0] - o[L - 3]) < 0.01 && Math.abs(o[1] - o[L - 2]) < 0.01 && Math.abs(o[2] - o[L - 1]) < 0.01) o.length = L - 3;
      return o;
    }));
    if (!c) continue;
    bStart.push(pos.length / 3); bld.push(sx / c, sy / c, base);
    for (const rs of local) {
      const ext = rs[0]; if (ext.length < 9) continue;
      let nx = 0, ny = 0, nz = 0; // Newell normal
      for (let i = 0; i < ext.length; i += 3) { const j = (i + 3) % ext.length; nx += (ext[i + 1] - ext[j + 1]) * (ext[i + 2] + ext[j + 2]); ny += (ext[i + 2] - ext[j + 2]) * (ext[i] + ext[j]); nz += (ext[i] - ext[j]) * (ext[i + 1] + ext[j + 1]); }
      const l = Math.hypot(nx, ny, nz); if (l < 1e-6) continue; nx /= l; ny /= l; nz /= l;
      if (nz < -0.5) continue;
      // project on the plane's main axes, triangulate (with holes), keep the original 3D points
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2];
      const v2 = (r: number[]) => { const a: Vector2[] = []; for (let i = 0; i < r.length; i += 3) a.push(new Vector2(r[i + u], r[i + v])); return a; };
      const rings = rs.filter((r) => r.length >= 9), flat = rings.flat();
      let t: number[][];
      try { t = ShapeUtils.triangulateShape(v2(rings[0]), rings.slice(1).map(v2)); } catch { continue; }
      const v0 = pos.length / 3, kind = nz > 0.25 ? 1 : 0;
      for (let i = 0; i < flat.length; i += 3) { pos.push(flat[i], flat[i + 1], flat[i + 2] - base); nrm.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127), kind); }
      // ShapeUtils may flip the winding: keep the triangles turned the way the face's normal points
      for (const [a, bb, cc] of t) {
        const p = (k: number) => [flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]], A_ = p(a), B = p(bb), C = p(cc);
        const cx = (B[1] - A_[1]) * (C[2] - A_[2]) - (B[2] - A_[2]) * (C[1] - A_[1]), cy = (B[2] - A_[2]) * (C[0] - A_[0]) - (B[0] - A_[0]) * (C[2] - A_[2]), cz = (B[0] - A_[0]) * (C[1] - A_[1]) - (B[1] - A_[1]) * (C[0] - A_[0]);
        if (cx * nx + cy * ny + cz * nz >= 0) idx.push(v0 + a, v0 + bb, v0 + cc); else idx.push(v0 + a, v0 + cc, v0 + bb);
      }
    }
  }
  return { lon, lat, nB: bStart.length, bld: Float32Array.from(bld), bStart: Uint32Array.from(bStart), pos: Float32Array.from(pos), nrm: Int8Array.from(nrm), idx: Uint32Array.from(idx) };
}

/* ---------- binary format ---------- */
const MAGIC = 0x44334545; // "EE3D"
/** header: magic, version, nB, nV, nI (u32), lon, lat (f64) = 36 bytes; then bld f32x3·nB, bStart u32·nB, pos f32x3·nV, nrm i8x4·nV, idx u32·nI */
export function encodeMesh(m: EMesh): Uint8Array {
  const nV = m.pos.length / 3, size = 36 + m.nB * 16 + nV * 16 + m.idx.length * 4, buf = new ArrayBuffer(size), dv = new DataView(buf);
  [MAGIC, 1, m.nB, nV, m.idx.length].forEach((v, i) => dv.setUint32(i * 4, v, true)); dv.setFloat64(20, m.lon, true); dv.setFloat64(28, m.lat, true);
  let o = 36; const put = (a: ArrayBufferView) => { new Uint8Array(buf, o, a.byteLength).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); o += a.byteLength; };
  put(m.bld); put(m.bStart); put(m.pos); put(m.nrm); put(m.idx);
  return new Uint8Array(buf);
}
export function decodeMesh(b: ArrayBuffer | Uint8Array): EMesh | null {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b), buf = (u.byteOffset % 4 ? u.slice().buffer : u.buffer) as ArrayBuffer, off = u.byteOffset % 4 ? 0 : u.byteOffset;
  if (u.byteLength < 36) return null;
  const dv = new DataView(buf, off), g = (i: number) => dv.getUint32(i * 4, true);
  if (g(0) !== MAGIC || g(1) !== 1) return null;
  const nB = g(2), nV = g(3), nI = g(4); if (u.byteLength !== 36 + nB * 16 + nV * 16 + nI * 4) return null;
  let o = off + 36; const take = <T>(C: new (b: ArrayBuffer, o: number, n: number) => T, n: number, s: number) => { const a = new C(buf, o, n); o += n * s; return a; };
  return { lon: dv.getFloat64(20, true), lat: dv.getFloat64(28, true), nB, bld: take(Float32Array, nB * 3, 4), bStart: take(Uint32Array, nB, 4), pos: take(Float32Array, nV * 3, 4), nrm: take(Int8Array, nV * 4, 1), idx: take(Uint32Array, nI, 4) };
}
/** Several municipalities' parts of one tile, merged into one mesh. */
export function mergeMeshes(ms: EMesh[]): EMesh | null {
  if (!ms.length) return null; if (ms.length === 1) return ms[0];
  const cat = <T extends Float32Array | Uint32Array | Int8Array>(C: new (n: number) => T, parts: T[]) => { const out = new C(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p as never, o); o += p.length; } return out; };
  let v = 0; const idx: Uint32Array[] = [], bs: Uint32Array[] = [];
  for (const m of ms) { idx.push(m.idx.map((i) => i + v)); bs.push(m.bStart.map((i) => i + v)); v += m.pos.length / 3; }
  return { lon: ms[0].lon, lat: ms[0].lat, nB: ms.reduce((s, m) => s + m.nB, 0), bld: cat(Float32Array, ms.map((m) => m.bld)), bStart: cat(Uint32Array, bs), pos: cat(Float32Array, ms.map((m) => m.pos)), nrm: cat(Int8Array, ms.map((m) => m.nrm)), idx: cat(Uint32Array, idx) };
}

/** Pixel box of tile x,y's orthophoto at zoom z (always a whole number of 256-px tiles: 4×4 at z17, 8×8 at z18). */
export const orthoTiles = (x: number, y: number, z: number) => { const k = 2 ** (z - EZ); return { x0: x * k, y0: y * k, n: k }; };
/** Orthophoto tiles the server passes on: z15-z18, inside Estonia's box only. */
export function validOrtho(z: number, x: number, y: number): boolean {
  if (![15, 16, 17, 18].includes(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const lon = x2lon(x + 0.5, z), lat = y2lat(y + 0.5, z);
  return lon > 21.6 && lon < 28.3 && lat > 57.45 && lat < 59.85;
}
/** Lowest camera distance (km): Estonia's 0.3 m orthophoto and LOD2 buildings hold up to 300 m; elsewhere the scene's own floor. */
export const EE_MIN_ALT = 0.3;
export const clampAltAt = (alt: number, lon: number, lat: number) => Math.max(inEstonia(lon, lat) ? EE_MIN_ALT : MIN_ALT, alt);
