// INTELLIGENCE, frame map: the owner's Higgsfield plate of the Earth (public/ui/frames/world.jpg, text-free) is the picture; live
// country pins and cards are placed on it. This file is the maths: lon/lat -> plate pixel, card placement, the dolly into a pin.
// The plate is art, not a projection, so the mapping is an exact interpolation through hand-set control points.
import { declutter } from "./classic-map-pure.ts";

export const PLATE = { w: 1344, h: 752 } as const;
export type FrameId = "world" | "europe" | "estonia" | "tallinn" | "village";
type Ctl = readonly (readonly [number, number, number, number])[];
export type FrameDef = { src: string; control: Ctl; shape: "oval" | "rect"; slots?: readonly (readonly [number, number])[]; bbox?: readonly [number, number, number, number] };

/** Each plate is art, not a projection: lon/lat -> plate pixel is an exact interpolation through landmarks read off the picture
 *  ([lon, lat, x, y]). The village plate has no real geography: its cards go to fixed slots. */
export const FRAMES: Record<FrameId, FrameDef> = {
  world: { src: "/ui/frames/world.jpg", shape: "oval", control: [
    [-74, 40.7, 345, 262], [-80.2, 25.8, 335, 335], [-35, -8, 492, 490], [18.4, -34, 700, 592], [0, 51.5, 640, 238], [31, 30, 768, 350],
    [73, 19, 915, 408], [140, 36, 1128, 305], [151, -34, 1140, 618], [37.6, 55.8, 800, 232], [3.4, 6.5, 665, 455], [116, 40, 1050, 300],
    [-122, 47.6, 262, 238], [107, -6, 1035, 505], [24.7, 59.4, 743, 205], [-43, -23, 440, 545], [77, 28.6, 925, 360], [-99, 19.4, 300, 385]] },
  europe: { src: "/ui/frames/europe.jpg", shape: "rect", bbox: [-12, 34, 40, 67], control: [
    [-0.13, 51.5, 340, 265], [-6.26, 53.35, 195, 215], [2.35, 48.86, 392, 352], [-3.7, 40.4, 175, 570], [-9.14, 38.7, 40, 595], [12.5, 41.9, 690, 548],
    [13.4, 52.5, 645, 322], [21, 52.2, 905, 255], [16.4, 48.2, 760, 395], [23.7, 38, 960, 630], [29, 41, 1215, 545], [18.07, 59.33, 790, 105],
    [30.5, 50.4, 1180, 300], [12.57, 55.68, 665, 205], [26.1, 44.4, 1080, 450], [10.75, 59.9, 700, 50], [4.9, 52.4, 520, 238], [14.4, 50.1, 760, 335], [24.7, 59.4, 985, 135], [19, 47.5, 870, 390]] },
  estonia: { src: "/ui/frames/estonia.jpg", shape: "rect", bbox: [21.5, 57.4, 28.5, 59.8], control: [
    [24.7536, 59.437, 600, 130], [26.729, 58.378, 980, 435], [28.19, 59.377, 1188, 158], [24.497, 58.386, 500, 440], [26.356, 59.346, 890, 241],
    [23.536, 58.943, 437, 278], [22.4853, 58.2481, 172, 437], [27.023, 57.834, 1077, 572], [26.0475, 57.7778, 860, 628], [22.75, 58.99, 200, 238]] },
  tallinn: { src: "/ui/frames/tallinn.jpg", shape: "rect", control: [], slots: [[480, 150], [1000, 215], [430, 540], [1040, 540], [720, 70]] }, // districts have no landmarks on the plate: the latest stories take open spots
  village: { src: "/ui/frames/village.jpg", shape: "rect", control: [], slots: [[860, 250], [560, 470], [1090, 410], [330, 330]] },
};
export const FRAME_IDS = Object.keys(FRAMES) as FrameId[];

function solve(rows: number[][], rhs: number[]): number[] {
  const n = rows[0].length, a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)).concat(rows.reduce((s, r, k) => s + r[i] * rhs[k], 0)));
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    [a[i], a[p]] = [a[p], a[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i] / a[i][i]; for (let c = i; c <= n; c++) a[r][c] -= f * a[i][c]; }
  }
  return a.map((r, i) => r[n] / r[i]);
}
type Fit = { cx: number[]; cy: number[]; res: number[][]; c0: [number, number]; sc: [number, number] };
const fits: Partial<Record<FrameId, Fit>> = {};
function fitFor(id: FrameId): Fit {
  const hit = fits[id]; if (hit) return hit;
  const ctl = FRAMES[id].control, c0: [number, number] = [ctl.reduce((s, c) => s + c[0], 0) / ctl.length, ctl.reduce((s, c) => s + c[1], 0) / ctl.length];
  const sc: [number, number] = [Math.max(1e-6, ...ctl.map((c) => Math.abs(c[0] - c0[0]))), Math.max(1e-6, ...ctl.map((c) => Math.abs(c[1] - c0[1])))];
  const terms = (lon: number, lat: number) => { const x = (lon - c0[0]) / sc[0], y = (lat - c0[1]) / sc[1]; return [1, x, y, x * x, x * y, y * y]; };
  const rows = ctl.map((c) => terms(c[0], c[1])), cx = solve(rows, ctl.map((c) => c[2])), cy = solve(rows, ctl.map((c) => c[3]));
  const dot = (c: number[], t: number[]) => c.reduce((s, v, i) => s + v * t[i], 0);
  return (fits[id] = { cx, cy, c0, sc, res: ctl.map((c) => [c[2] - dot(cx, terms(c[0], c[1])), c[3] - dot(cy, terms(c[0], c[1]))]) });
}

/** Plate pixel of a place on a plate (the world plate by default). Exact at the control points, smooth between. */
export function platePoint(lon: number, lat: number, id: FrameId = "world"): { x: number; y: number } {
  const f = fitFor(id), ctl = FRAMES[id].control, x0 = (lon - f.c0[0]) / f.sc[0], y0 = (lat - f.c0[1]) / f.sc[1];
  const t = [1, x0, y0, x0 * x0, x0 * y0, y0 * y0], dot = (c: number[]) => c.reduce((s, v, i) => s + v * t[i], 0);
  let x = dot(f.cx), y = dot(f.cy), sw = 0, rx = 0, ry = 0;
  for (let i = 0; i < ctl.length; i++) {
    const d2 = ((ctl[i][0] - lon) / f.sc[0]) ** 2 + ((ctl[i][1] - lat) / f.sc[1]) ** 2;
    if (d2 < 1e-12) { rx = f.res[i][0]; ry = f.res[i][1]; sw = 1; break; }
    const w = 1 / (d2 * d2); sw += w; rx += w * f.res[i][0]; ry += w * f.res[i][1];
  }
  if (sw) { x += rx / sw; y += ry / sw; }
  return { x, y };
}

/** Is a place on the plate's picture? World: inside the visible globe's oval. Others: inside the geographic box and the plate. */
export function onPlate(p: { x: number; y: number }, id: FrameId = "world"): boolean {
  if (FRAMES[id].shape === "oval") { const nx = (p.x - PLATE.w / 2) / (PLATE.w * 0.47), ny = (p.y - 400) / (PLATE.h * 0.46); return nx * nx + ny * ny < 1; }
  return p.x > 30 && p.x < PLATE.w - 30 && p.y > 40 && p.y < PLATE.h - 30;
}
function inBox(id: FrameId, lon: number, lat: number): boolean {
  const b = FRAMES[id].bbox; return !b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
}

export type Pin = { name: string; x: number; y: number; count: number; r: number; card: boolean; cx: number; cy: number };
/** Pins for the busiest places on a plate: dot size by story count, cards for the top `cards` that fit. Cards go beside their pin on
 *  the free side, most important first, never over each other or a keep-out box. */
export function pinsFor(hs: { name: string; lon: number; lat: number; count: number }[], opt: { frame?: FrameId; cards?: number; cardW?: number; cardH?: number; keepOut?: { x: number; y: number; w: number; h: number }[] } = {}): Pin[] {
  const { frame = "world", cards = 6, cardW = 150, cardH = 46, keepOut = [] } = opt, def = FRAMES[frame];
  const top = [...hs].filter((h) => h.count > 0).sort((a, b) => b.count - a.count).slice(0, frame === "world" ? 14 : 12), max = Math.max(1, top[0]?.count ?? 1);
  const pts = top.map((h, i) => ({ h, p: def.slots ? { x: def.slots[i % def.slots.length][0], y: def.slots[i % def.slots.length][1] } : platePoint(h.lon, h.lat, frame) }))
    .filter((e) => (def.slots ? true : inBox(frame, e.h.lon, e.h.lat) && onPlate(e.p, frame))).slice(0, def.slots ? def.slots.length : 99);
  const laid = declutter(pts.map((e, i) => ({ id: e.h.name, x: e.p.x, y: e.p.y, w: i < cards ? cardW : 0, h: i < cards ? cardH : 0, rank: i, facing: 1 })), keepOut, PLATE);
  return pts.map((e, i) => {
    const l = laid[i];
    return { name: e.h.name, x: e.p.x, y: e.p.y, count: e.h.count, r: 5 + 11 * Math.sqrt(e.h.count / max), card: i < cards && l.show, cx: l.x, cy: l.y };
  });
}

/** Where a pick on one plate goes next: another plate, or null = the real 3D Earth. Europe is reached from the world plate by any
 *  European country, Estonia from either; in Estonia Tallinn opens its old town and a village opens the village plate. */
export function nextFrame(from: FrameId, pick: { name: string; lon: number; lat: number; kind?: string }): FrameId | null {
  if (from === "world" || from === "europe") {
    if (pick.name === "Estonia") return "estonia";
    return from === "world" && pick.lon >= -12 && pick.lon <= 45 && pick.lat >= 34 && pick.lat <= 67 ? "europe" : null;
  }
  if (from === "estonia") return pick.name === "Tallinn" ? "tallinn" : pick.kind === "village" ? "village" : null;
  return null;
}
/** The bar's tabs on the plates: Earth -> world, Estonia and Towns -> Estonia, Tallinn -> the old town. */
export function tabFrame(place: "orbit" | "country" | "region" | "town"): FrameId { return place === "orbit" ? "world" : place === "town" ? "tallinn" : "estonia"; }

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
