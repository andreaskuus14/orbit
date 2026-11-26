// INTELLIGENCE, frame map: the owner's Higgsfield plate of the Earth (public/ui/frames/world.jpg, text-free) is the picture; live
// country pins and cards are placed on it. This file is the maths: lon/lat -> plate pixel, card placement, the dolly into a pin.
// The plate is art, not a projection, so the mapping is an exact interpolation through hand-set control points.
import { declutter } from "./classic-map-pure.ts";

export const PLATE = { w: 1344, h: 752 } as const;

/** [lon, lat, plate x, plate y]: landmarks read off world.jpg. */
export const CONTROL: readonly (readonly [number, number, number, number])[] = [
  [-74, 40.7, 345, 262], [-80.2, 25.8, 335, 335], [-35, -8, 492, 490], [18.4, -34, 700, 592], [0, 51.5, 640, 238], [31, 30, 768, 350],
  [73, 19, 915, 408], [140, 36, 1128, 305], [151, -34, 1140, 618], [37.6, 55.8, 800, 232], [3.4, 6.5, 665, 455], [116, 40, 1050, 300],
  [-122, 47.6, 262, 238], [107, -6, 1035, 505], [24.7, 59.4, 743, 205], [-43, -23, 440, 545], [77, 28.6, 925, 360], [-99, 19.4, 300, 385],
];

/** Least-squares quadratic fit (6 terms) per axis, then exact correction at the control points by inverse-distance weights. */
function solve(rows: number[][], rhs: number[]): number[] {
  const n = rows[0].length, a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)).concat(rows.reduce((s, r, k) => s + r[i] * rhs[k], 0)));
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    [a[i], a[p]] = [a[p], a[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i] / a[i][i]; for (let c = i; c <= n; c++) a[r][c] -= f * a[i][c]; }
  }
  return a.map((r, i) => r[n] / r[i]);
}
const terms = (lon: number, lat: number) => { const x = lon / 100, y = lat / 100; return [1, x, y, x * x, x * y, y * y]; };
const ROWS = CONTROL.map((c) => terms(c[0], c[1]));
const CX = solve(ROWS, CONTROL.map((c) => c[2])), CY = solve(ROWS, CONTROL.map((c) => c[3]));
const dot = (c: number[], t: number[]) => c.reduce((s, v, i) => s + v * t[i], 0);
const RES = CONTROL.map((c) => [c[2] - dot(CX, terms(c[0], c[1])), c[3] - dot(CY, terms(c[0], c[1]))]);

/** Plate pixel of a place. Exact at the control points, smooth between. */
export function platePoint(lon: number, lat: number): { x: number; y: number } {
  const t = terms(lon, lat); let x = dot(CX, t), y = dot(CY, t), sw = 0, rx = 0, ry = 0;
  for (let i = 0; i < CONTROL.length; i++) {
    const d2 = (CONTROL[i][0] - lon) ** 2 + (CONTROL[i][1] - lat) ** 2;
    if (d2 < 1e-6) { rx = RES[i][0]; ry = RES[i][1]; sw = 1; break; }
    const w = 1 / (d2 * d2); sw += w; rx += w * RES[i][0]; ry += w * RES[i][1];
  }
  if (sw) { x += rx / sw; y += ry / sw; }
  return { x, y };
}

/** Is the place on the plate's visible globe (the oval)? Far-side places are not pinned. */
export function onPlate(p: { x: number; y: number }): boolean {
  const nx = (p.x - PLATE.w / 2) / (PLATE.w * 0.47), ny = (p.y - 400) / (PLATE.h * 0.46);
  return nx * nx + ny * ny < 1;
}

export type Pin = { name: string; x: number; y: number; count: number; r: number; card: boolean; cx: number; cy: number };
/** Pins for the busiest countries: dot size by story count, cards (flag + name + headline) for the top `cards` that fit.
 *  Cards are placed beside their pin on the free side, most important first, never over each other or a keep-out box. */
export function pinsFor(hs: { name: string; lon: number; lat: number; count: number }[], opt: { cards?: number; cardW?: number; cardH?: number; keepOut?: { x: number; y: number; w: number; h: number }[] } = {}): Pin[] {
  const { cards = 6, cardW = 150, cardH = 46, keepOut = [] } = opt;
  const top = [...hs].sort((a, b) => b.count - a.count).slice(0, 14), max = Math.max(1, top[0]?.count ?? 1);
  const pts = top.map((h) => ({ h, p: platePoint(h.lon, h.lat) })).filter((e) => onPlate(e.p));
  const laid = declutter(pts.map((e, i) => ({ id: e.h.name, x: e.p.x, y: e.p.y, w: i < cards ? cardW : 0, h: i < cards ? cardH : 0, rank: i, facing: 1 })), keepOut, PLATE);
  return pts.map((e, i) => {
    const l = laid[i];
    return { name: e.h.name, x: e.p.x, y: e.p.y, count: e.h.count, r: 5 + 11 * Math.sqrt(e.h.count / max), card: i < cards && l.show, cx: l.x, cy: l.y };
  });
}

/** The camera on the plate for a stage of sw x sh: the scale that fits the whole plate, and its top-left corner. */
export function fit(sw: number, sh: number, ox = 0, oy = 0): { s: number; x: number; y: number } {
  const s = Math.min(sw / PLATE.w, sh / PLATE.h);
  return { s, x: ox + (sw - PLATE.w * s) / 2, y: oy + (sh - PLATE.h * s) / 2 };
}

/** The dolly into a pin: k 0..1 -> plate scale factor and the plate point that stays under the pin's screen position. Eased in-out. */
export function dolly(k: number, maxZoom = 3.4): number {
  const e = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  return 1 + (maxZoom - 1) * e;
}
/** Crossfade for the same k: the plate fades out over the last 45 % of the dolly while the next level fades in. */
export function plateOpacity(k: number): number { return k <= 0.55 ? 1 : k >= 1 ? 0 : 1 - (k - 0.55) / 0.45; }
