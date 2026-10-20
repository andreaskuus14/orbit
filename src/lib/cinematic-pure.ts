// Pure maths behind the galaxy's cinematic feel: damped zoom inertia, idle drift, motion → chromatic aberration,
// and the HUD's text-scramble reveal. No three.js / DOM, so it runs under node --test.

/** Frame-rate independent exponential approach (same curve as THREE.MathUtils.damp). */
export const damp = (cur: number, target: number, lambda: number, dt: number) =>
  target + (cur - target) * Math.exp(-lambda * Math.max(0, dt));

/** One wheel event → a velocity kick on log(distance) per second. Normalises pixel/line/page deltas and caps
 *  big trackpad flings so one swipe can't teleport the camera. Positive = zoom out (wheel down). */
export function wheelKick(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 0;
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.max(-160, Math.min(160, px)) * 0.007; // one 100 px notch ≈ 10% closer/further, spread over ~0.4 s
}

/** Advances the zoom inertia: distance moves along its log so zooming feels even near and far, the velocity decays
 *  to rest (friction per second), and hitting min/max kills the velocity instead of bouncing. */
export function stepZoom(dist: number, vel: number, dt: number, min: number, max: number, friction = 7) {
  const t = Number.isFinite(dt) ? Math.min(Math.max(0, dt), 0.1) : 0; // a long hitch must not fling the camera
  let d = dist * Math.exp(vel * t);
  let v = vel * Math.exp(-friction * t);
  if (d <= min || d >= max) { d = Math.min(max, Math.max(min, d)); v = 0; }
  if (Math.abs(v) < 1e-3) v = 0;
  return { dist: d, vel: v };
}

/** Idle drift speed (OrbitControls autoRotateSpeed units): nothing for `wait` s after the last input, then eases in. */
export function idleDrift(idleSecs: number, wait = 8, ramp = 4, max = 0.18) {
  if (!(idleSecs > wait)) return 0;
  const k = Math.min(1, (idleSecs - wait) / ramp);
  return max * k * k * (3 - 2 * k); // smoothstep: no visible kick when it starts
}

/** Camera speed (fraction of the orbit distance per second) → chromatic aberration offset. ~0 at rest and during
 *  idle drift and planet-follow (speed < 0.15), saturates at `max` on fast flights so the fringe never gets ugly. */
export function aberrationFor(speed: number, max = 0.0022, deadZone = 0.15) {
  if (!Number.isFinite(speed) || speed <= deadZone) return 0;
  return max * (1 - Math.exp(-(speed - deadZone) * 1.6));
}

export const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>[]";

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Decrypt-style reveal: characters lock in left to right as progress goes 0 → 1; the rest are random glyphs.
 *  Spaces and punctuation stay put so the word shapes read early. Same (text, progress, seed) → same string. */
export function scramble(text: string, progress: number, seed = 1, glyphs = GLYPHS): string {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
  if (p >= 1) return text;
  const r = rng(seed);
  const locked = Math.floor(p * text.length);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += i < locked || !/[A-Za-z0-9]/.test(c) ? c : glyphs[Math.floor(r() * glyphs.length)];
  }
  return out;
}

/** HUD coordinate: fixed width, explicit sign, e.g. "+004.21" / "-012.00". */
export const fmtCoord = (n: number) =>
  (n < 0 ? "-" : "+") + Math.abs(Number.isFinite(n) ? n : 0).toFixed(2).padStart(6, "0");

/* ---------- the camera story: intro flight, scroll journey, label declutter ---------- */

type Num = { [i: number]: number; readonly length: number };
const clamp01 = (x: number) => (x <= 0 || !Number.isFinite(x) ? 0 : x >= 1 ? 1 : x);
export const easeInOutCubic = (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; };
export const easeInOutQuint = (t: number) => { t = clamp01(t); return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2; };

/** Critically damped spring (Unity's SmoothDamp) on one axis: keeps velocity across retargets, so chained glides
 *  never jerk. Writes the new velocity to vel[i]; settles in ~3.5 × smoothTime, the same at 30 and 60 fps. */
export function smoothDamp(cur: number, target: number, vel: Num, i: number, smoothTime: number, dt: number) {
  const t = Number.isFinite(dt) ? Math.min(Math.max(0, dt), 0.1) : 0;
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * t;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, temp = (vel[i] + omega * change) * t;
  vel[i] = (vel[i] - omega * temp) * k;
  return target + (change + temp) * k;
}

/** Uniform Catmull-Rom on flat xyz keyframes (end points repeated): writes the point at u ∈ [0,1] to out[o..o+2]. */
export function catmullRom(pts: Num, u: number, out: Num, o = 0) {
  const n = pts.length / 3 - 1, f = clamp01(u) * n, s = Math.min(n - 1, Math.floor(f)), t = f - s;
  const i0 = Math.max(0, s - 1) * 3, i1 = s * 3, i2 = (s + 1) * 3, i3 = Math.min(n, s + 2) * 3;
  const t2 = t * t, t3 = t2 * t;
  for (let a = 0; a < 3; a++) {
    const p0 = pts[i0 + a], p1 = pts[i1 + a], p2 = pts[i2 + a], p3 = pts[i3 + a];
    out[o + a] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
  }
}

export const HOME_POS = [-8, 14, 44] as const; // the overview camera (looks at the CORE at the origin)
export const INTRO_SECS = 2.4;
// Low beside the CORE looking out across the disc, swinging wide and rising to the overview.
const INTRO_CAM = [2.4, 1.1, 5.4, 9.5, 2.2, 11, 7, 7.5, 30, ...HOME_POS];
const INTRO_LOOK = [-7, 0.8, -15, 0, 0, 0];

/** Camera position (out[0..2]) and look target (out[3..5]) at intro progress t ∈ [0,1]. The look turns a little later
 *  than the body moves (quint vs cubic), which gives the arc its parallax. */
export function introPose(t: number, out: Num) {
  catmullRom(INTRO_CAM, easeInOutCubic(t), out, 0);
  const e = easeInOutQuint(t);
  for (let a = 0; a < 3; a++) out[3 + a] = INTRO_LOOK[a] + (INTRO_LOOK[3 + a] - INTRO_LOOK[a]) * e;
}

/** Labels fade in one after another over the last part of the intro (1 = fully shown). */
export const introLabelAlpha = (t: number, i: number, n: number) => clamp01((t - (0.7 + (0.2 * i) / Math.max(1, n))) / 0.08);

/** One stop's framing: camera outside the planet (x, z) looking back toward the CORE, low, with the planet on the
 *  right third (aspect/fov aware) and the system behind it. out = [cx, cy, cz, tx, ty, tz]. */
export function framePose(px: number, pz: number, size: number, aspect: number, fovDeg: number, out: Num) {
  const r = Math.hypot(px, pz) || 1, ux = px / r, uz = pz / r;
  const k = Math.max(1, size / 0.75), d = 4.2 * k;
  const lat = 0.3 * Math.max(0.5, aspect) * Math.tan((fovDeg * Math.PI) / 360) * d; // screen-right = (uz, 0, -ux)
  out[0] = px + ux * d * 0.94; out[1] = d * 0.34; out[2] = pz + uz * d * 0.94;
  out[3] = px - uz * lat; out[4] = 0; out[5] = pz + ux * lat;
}

export type WheelGate = { acc: number; last: number; locked: boolean; lockStart: number };
export const wheelGate = (): WheelGate => ({ acc: 0, last: -1e9, locked: false, lockStart: 0 });

/** Wheel / trackpad deltas → at most one stop per flick (-1 back, +1 forward, 0 nothing). Deltas add up to a
 *  threshold; after a step the gate locks until the wheel goes quiet (trackpad inertia tails can't add a second stop),
 *  or, after the ~1 s glide, a fresh big delta (a held mouse wheel keeps stepping). */
export function wheelStep(g: WheelGate, deltaY: number, deltaMode: number, now: number, threshold = 40): -1 | 0 | 1 {
  if (!Number.isFinite(deltaY) || !Number.isFinite(now)) return 0;
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const gap = now - g.last;
  g.last = now;
  if (gap > 180) { g.acc = 0; g.locked = false; }
  if (g.locked) {
    if (now - g.lockStart < 1000 || Math.abs(px) < 40) return 0;
    g.locked = false; g.acc = 0;
  }
  g.acc += Math.max(-200, Math.min(200, px));
  if (Math.abs(g.acc) < threshold) return 0;
  const s = g.acc > 0 ? 1 : -1;
  g.acc = 0; g.locked = true; g.lockStart = now;
  return s;
}

/** -1 = overview, 0..n-1 = planet stops; scrolling back past the first stop returns to the overview. */
export const stepStop = (stop: number, dir: number, n: number) => Math.max(-1, Math.min(n - 1, stop + dir));

/** Screen-space declutter: labels in priority order (prio < 0 = hidden); one whose box (w[i] × h px, centred) overlaps
 *  an already shown label is hidden. Writes 1/0 to vis; `order` is scratch of the same length (no allocations). */
export function cullLabels(x: Num, y: Num, w: Num, h: number, prio: Num, vis: Num, order: Num) {
  const n = x.length;
  for (let i = 0; i < n; i++) { order[i] = i; vis[i] = 0; }
  for (let i = 1; i < n; i++) { // insertion sort by priority, highest first (n ≈ 12)
    const v = order[i];
    let j = i - 1;
    while (j >= 0 && prio[order[j]] < prio[v]) { order[j + 1] = order[j]; j--; }
    order[j + 1] = v;
  }
  for (let a = 0; a < n; a++) {
    const i = order[a];
    if (prio[i] < 0) break;
    let free = true;
    for (let b = 0; b < a && free; b++) {
      const j = order[b];
      if (vis[j] && Math.abs(x[i] - x[j]) < (w[i] + w[j]) / 2 && Math.abs(y[i] - y[j]) < h) free = false;
    }
    vis[i] = free ? 1 : 0;
  }
}
