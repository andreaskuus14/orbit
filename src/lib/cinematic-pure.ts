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
