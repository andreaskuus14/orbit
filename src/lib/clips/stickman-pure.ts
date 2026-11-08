// Stickman actor (W03 / E02): pose keyframes on exact frames, eased with overlap (head and forearms trail the body), planted
// feet by 2-bone IK, an acting check (anticipation, holds, no linear big moves) and an RGB rasterizer for local, deterministic
// placeholder animation. Stage units: a 1000x1000 square, y down, ground at GROUND. Used by scene-manifest-pure.ts.

export const GROUND = 900;
const TORSO = 170, NECK = 55, UPPER = 95, FORE = 90, THIGH = 105, SHIN = 100;

/** Angles in degrees: 0 = straight down, +90 = toward +x. Feet are x offsets from the scene's home x (they stay planted). */
export type Pose = { dx: number; dy: number; lean: number; head: number; uaL: number; faL: number; uaR: number; faR: number; ftL: number; ftR: number };
export type Ease = "linear" | "in" | "out" | "inOut" | "back";
export type Key = { f: number; pose?: string; set?: Partial<Pose>; ease?: Ease };
export const JOINTS: (keyof Pose)[] = ["dx", "dy", "lean", "head", "uaL", "faL", "uaR", "faR", "ftL", "ftR"];

export const POSES: Record<string, Pose> = {
  neutral: { dx: 0, dy: 0, lean: 0, head: 0, uaL: -10, faL: -6, uaR: 10, faR: 6, ftL: -45, ftR: 45 },
  "wind-up": { dx: -6, dy: 18, lean: -10, head: -8, uaL: -25, faL: -10, uaR: -25, faR: -35, ftL: -45, ftR: 45 },
  "point-up": { dx: 6, dy: 0, lean: 8, head: 14, uaL: -28, faL: -12, uaR: 122, faR: 4, ftL: -45, ftR: 45 },
  "arms-in": { dx: 0, dy: 14, lean: 4, head: 8, uaL: 35, faL: 85, uaR: -35, faR: -85, ftL: -45, ftR: 45 },
  "spread-wide": { dx: 0, dy: -6, lean: 0, head: -4, uaL: -100, faL: -12, uaR: 100, faR: 12, ftL: -70, ftR: 70 },
  "stretch-up": { dx: 0, dy: -10, lean: 0, head: -10, uaL: -165, faL: -8, uaR: 165, faR: 8, ftL: -60, ftR: 60 },
  "open-palms": { dx: 4, dy: 0, lean: 6, head: 8, uaL: -50, faL: -40, uaR: 50, faR: 42, ftL: -45, ftR: 45 },
  "hands-hips": { dx: 0, dy: -4, lean: -3, head: -6, uaL: -42, faL: 112, uaR: 42, faR: -112, ftL: -55, ftR: 55 },
};

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2, // overshoot then settle: follow-through
};
/** Frames a joint trails the root (overlapping action). */
export const DELAY: Partial<Record<keyof Pose, number>> = { head: 2, uaL: 1, uaR: 1, faL: 3, faR: 3 };

export const keyPose = (k: Key): Pose => ({ ...POSES[k.pose ?? "neutral"], ...k.set });

/** One joint's value at a (possibly fractional) frame; before the first / after the last key it holds. */
function joint(keys: Key[], poses: Pose[], j: keyof Pose, f: number): number {
  if (f <= keys[0].f) return poses[0][j];
  for (let i = 1; i < keys.length; i++) {
    if (f > keys[i].f) continue;
    const t = (f - keys[i - 1].f) / (keys[i].f - keys[i - 1].f);
    return poses[i - 1][j] + (poses[i][j] - poses[i - 1][j]) * EASES[keys[i].ease ?? "inOut"](t);
  }
  return poses[poses.length - 1][j];
}
export function sample(keys: Key[], f: number): Pose {
  const poses = keys.map(keyPose), p = {} as Pose;
  for (const j of JOINTS) p[j] = joint(keys, poses, j, f - (DELAY[j] ?? 0));
  return p;
}

const BIG = 35; // degrees (dy counts as degrees): a move this large needs anticipation and easing
const ANGLES: (keyof Pose)[] = ["lean", "head", "uaL", "faL", "uaR", "faR", "dy"];
export type Acting = { anticipations: number; holds: number; linearBig: number; offFrame: number[]; ok: boolean };
/** E02's acting rules for one scene's keys: every key on a whole frame inside the scene, ≥1 anticipation (the joint that makes a
 *  big move first goes the other way), ≥1 hold (≥ 8 frames with no change), no big move with linear timing. */
export function actingReport(keys: Key[], frames: number): Acting {
  const poses = keys.map(keyPose);
  const offFrame = keys.map((k) => k.f).filter((f) => !Number.isInteger(f) || f < 0 || f > frames);
  let anticipations = 0, holds = 0, linearBig = 0;
  for (let i = 1; i < keys.length; i++) {
    const d = (j: keyof Pose, a: number) => poses[a][j] - poses[a - 1][j];
    const big = ANGLES.filter((j) => Math.abs(d(j, i)) >= BIG);
    if (big.length && (keys[i].ease ?? "inOut") === "linear") linearBig++;
    if (i > 1 && big.some((j) => Math.sign(d(j, i - 1)) === -Math.sign(d(j, i)) && Math.abs(d(j, i - 1)) >= 3)) anticipations++;
    if (keys[i].f - keys[i - 1].f >= 8 && JOINTS.every((j) => Math.abs(d(j, i)) < 1e-9)) holds++;
  }
  if (frames - keys[keys.length - 1].f >= 8) holds++; // the closing hold
  return { anticipations, holds, linearBig, offFrame, ok: !offFrame.length && anticipations >= 1 && holds >= 1 && linearBig === 0 };
}

// ---- skeleton ----

type P = [number, number];
const dir = (deg: number, len: number): P => [Math.sin((deg * Math.PI) / 180) * len, Math.cos((deg * Math.PI) / 180) * len];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
/** 2-bone IK: knee toward `face` (+1 right, -1 left). Feet out of reach get the straight-leg point. */
function knee(h: P, f: P, face: number): P {
  const dx = f[0] - h[0], dy = f[1] - h[1], d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 0.01);
  const a = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
  const base = Math.atan2(dy, dx), pick = (s: number): P => [h[0] + Math.cos(base + s * a) * THIGH, h[1] + Math.sin(base + s * a) * THIGH];
  const k1 = pick(1), k2 = pick(-1);
  return (k1[0] - k2[0]) * face >= 0 ? k1 : k2;
}
export type Rig = { head: P; headR: number; eyes: P[]; mouth: P; segs: [P, P][] };
/** Stage-unit geometry of a pose; mouth 0..1 opens it (driven by the fake voice). */
export function rig(p: Pose, home: number, face: number, headR = 45): Rig {
  const hip: P = [home + p.dx, GROUND - (THIGH + SHIN) * 0.97 + p.dy];
  const neck = add(hip, dir(180 + p.lean, TORSO)), sh = add(neck, dir(p.lean, 18));
  const head = add(neck, dir(180 + p.lean + p.head * face, NECK));
  const elL = add(sh, dir(p.lean + p.uaL, UPPER)), elR = add(sh, dir(p.lean + p.uaR, UPPER));
  const hL = add(elL, dir(p.lean + p.uaL + p.faL, FORE)), hR = add(elR, dir(p.lean + p.uaR + p.faR, FORE));
  const fL: P = [home + p.ftL, GROUND], fR: P = [home + p.ftR, GROUND];
  const kL = knee(hip, fL, face), kR = knee(hip, fR, face);
  const rot = (x: number, y: number): P => { const a = ((p.lean + p.head * face) * Math.PI) / 180; return [head[0] + x * Math.cos(a) - y * Math.sin(a), head[1] + x * Math.sin(a) + y * Math.cos(a)]; };
  return { head, headR, eyes: [rot(face * 8, -8), rot(face * 24, -8)], mouth: rot(face * 18, 18),
    segs: [[hip, neck], [sh, elL], [elL, hL], [sh, elR], [elR, hR], [hip, kL], [kL, fL], [hip, kR], [kR, fR]] };
}
/** Stage-unit bounding box of a rig (line half-width included). */
export function rigBox(r: Rig, line: number): [number, number, number, number] {
  const xs = r.segs.flat().map((q) => q[0]), ys = r.segs.flat().map((q) => q[1]), w = line / 2;
  return [Math.min(...xs, r.head[0] - r.headR) - w, Math.min(...ys, r.head[1] - r.headR) - w, Math.max(...xs, r.head[0] + r.headR) + w, Math.max(...ys, r.head[1] + r.headR) + w];
}

// ---- raster (RGB24) ----

export type Img = { w: number; h: number; px: Uint8Array };
export type RGB = [number, number, number];
export const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export function image(w: number, h: number, c: RGB): Img {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < px.length; i += 3) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
  return { w, h, px };
}
/** Paints coverage(x, y) ∈ [0,1] over a clipped box: anti-aliased shapes from a distance function. */
function paint(img: Img, x0: number, y0: number, x1: number, y1: number, c: RGB, cov: (x: number, y: number) => number) {
  const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0)), bx = Math.min(img.w - 1, Math.ceil(x1)), by = Math.min(img.h - 1, Math.ceil(y1));
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const a = cov(x + 0.5, y + 0.5);
    if (a <= 0) continue;
    const i = (y * img.w + x) * 3, p = img.px;
    p[i] += Math.round((c[0] - p[i]) * Math.min(1, a)); p[i + 1] += Math.round((c[1] - p[i + 1]) * Math.min(1, a)); p[i + 2] += Math.round((c[2] - p[i + 2]) * Math.min(1, a));
  }
}
export const rect = (img: Img, x0: number, y0: number, x1: number, y1: number, c: RGB) =>
  paint(img, x0, y0, x1, y1, c, (x, y) => Math.min(x - x0, x1 - x, y - y0, y1 - y) + 0.5);
export const disk = (img: Img, cx: number, cy: number, r: number, c: RGB) =>
  paint(img, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, c, (x, y) => r - Math.hypot(x - cx, y - cy) + 0.5);
export const ring = (img: Img, cx: number, cy: number, r: number, w: number, c: RGB) =>
  paint(img, cx - r - w, cy - r - w, cx + r + w, cy + r + w, c, (x, y) => w / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5);
export function capsule(img: Img, a: P, b: P, r: number, c: RGB) {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
  paint(img, Math.min(a[0], b[0]) - r - 1, Math.min(a[1], b[1]) - r - 1, Math.max(a[0], b[0]) + r + 1, Math.max(a[1], b[1]) + r + 1, c, (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2));
    return r - Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy) + 0.5;
  });
}
/** Draws a rig through `to` (stage → pixels) with a stage-unit line width. */
export function drawRig(img: Img, r: Rig, to: (q: P) => P, scale: number, line: number, c: RGB, bg: RGB, mouth: number) {
  const w = line * scale;
  for (const [a, b] of r.segs) capsule(img, to(a), to(b), w / 2, c);
  const h = to(r.head);
  disk(img, h[0], h[1], r.headR * scale, bg);
  ring(img, h[0], h[1], r.headR * scale, w, c);
  for (const e of r.eyes) { const q = to(e); disk(img, q[0], q[1], 4.5 * scale, c); }
  const m = to(r.mouth), open = Math.max(0, Math.min(1, mouth)) * 9 * scale;
  capsule(img, [m[0] - 7 * scale, m[1]], [m[0] + 7 * scale, m[1]], (2.5 + open * 0.15) * scale, c);
  if (open > 0.5) disk(img, m[0], m[1] + 1, open, c);
}
