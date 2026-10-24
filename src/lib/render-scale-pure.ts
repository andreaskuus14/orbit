// Galaxy render resolution. The galaxy is fill-rate bound at big windows (owner's PC: 45.8 fps at a 1901 px wide
// window, dpr 1.25, 93 fps at ~600 px), so the scene draws at a lower pixel ratio when frames run long, instead of
// dropping effects. The DOM UI (labels, HUD, panels) is unaffected: it stays crisp.

/** At most this many drawn pixels, whatever the window (a 4K screen at dpr 1.5 would be 8.3 MP). */
export const MAX_PX = 3.7e6;
/** Never below this pixel ratio (or the screen's own, when that is lower): past it the softening shows. */
export const MIN_DPR = 0.85;
/** One step: x0.9 on the pixel ratio (~0.81x the pixels). */
export const STEP = 0.9;
/** A 0.5 s window is slow when its worst frame is over SLOW_MS or it averages under SLOW_FPS (the goal is p95 <= 16.7 ms;
 *  a window's worst frame sits above its p95). Fast = clear headroom: one step up still stays under the goal. */
export const SLOW_MS = 19, SLOW_FPS = 55, FAST_FPS = 90, FAST_MS = 14;
export const DOWN_AFTER = 1.5, UP_AFTER = 6; // seconds of consecutive slow / fast windows

export type ScaleState = { scale: number; low: number; high: number };

const fin = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);

/** Start from the scale this PC settled on last time, one step higher: a 60 Hz screen can never show headroom, so a
 *  transient slowdown must not lower the resolution for good. Nonsense (NaN, 0, missing) starts at full. */
export const newScale = (saved: number): ScaleState => ({ scale: saved > 0 ? fin(saved / STEP, 0.3, 1, 1) : 1, low: 0, high: 0 });

/** The canvas pixel ratio: the screen's ratio within [1, maxDpr] (as before), times the scale, under the pixel cap,
 *  never below MIN_DPR (or the base itself, if that is lower). Rounded so tiny changes don't resize the canvas. */
export function renderDpr(cssW: number, cssH: number, deviceDpr: number, maxDpr: number, scale: number, maxPx = MAX_PX): number {
  const base = fin(deviceDpr, 1, Math.max(1, maxDpr), 1);
  const area = Math.max(1, fin(cssW, 1, 1e5, 1) * fin(cssH, 1, 1e5, 1));
  const dpr = Math.min(base * fin(scale, 0, 1, 1), Math.sqrt(maxPx / area));
  return Math.round(Math.max(dpr, Math.min(base, MIN_DPR)) * 100) / 100;
}

/** Feed one 0.5 s window (fps = its average, worstMs = its slowest frame). Steps the scale down after DOWN_AFTER s of
 *  slow windows, up after UP_AFTER s of fast ones; one hitch resets the run (a GC pause is not a fill-rate problem). */
export function stepScale(s: ScaleState, fps: number, dt: number, worstMs: number, floor = 0.3): ScaleState {
  if (!Number.isFinite(fps) || !Number.isFinite(dt) || !Number.isFinite(worstMs) || dt <= 0 || dt > 2) return s; // hidden tab or a stall: no evidence
  const slow = worstMs > SLOW_MS || fps < SLOW_FPS, fast = fps >= FAST_FPS && worstMs < FAST_MS;
  const low = slow ? s.low + dt : 0, high = fast ? s.high + dt : 0;
  if (low >= DOWN_AFTER && s.scale > floor) return { scale: Math.max(floor, s.scale * STEP), low: 0, high: 0 };
  if (high >= UP_AFTER && s.scale < 1) return { scale: Math.min(1, s.scale / STEP), low: 0, high: 0 };
  return { scale: s.scale, low, high };
}

/** The lowest scale that still changes anything: below it renderDpr holds MIN_DPR. */
export const scaleFloor = (deviceDpr: number, maxDpr: number) => {
  const base = fin(deviceDpr, 1, Math.max(1, maxDpr), 1);
  return Math.min(1, MIN_DPR / base);
};
