// Alien behaviour (research: things that break physical rules read as non-human). Pure, allocation-free helpers:
// inertia-less arrivals (accelerate INTO stillness, stop dead), unseen change (only while nobody is watching),
// and the detuned cluster that converges to unison.

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Ease-in that ends in a hard stop: speed only grows and is highest at t = 1, then the motion is simply over.
 *  k is the starting speed share (0 = from rest, quadratic). Never leaves [0, 1]: no overshoot. */
export function easeInStop(t: number, k = 0): number {
  const x = clamp01(t), s = clamp01(k);
  return x * (s + (1 - s) * x);
}

/** A planet fly-to's duration (s): the old glide landed in ~3x its smoothTime; this one simply ends. */
export const arrivalSecs = (dist: number, fast = false) => {
  const d = Number.isFinite(dist) ? Math.max(0, dist) : 0;
  return fast ? Math.min(0.9, 0.4 + d / 110) : Math.min(1.5, 0.7 + d / 55);
};

/** Reversed explosion: a world's moons start scattered (this factor x their orbit) and converge, accelerating, into place. */
export const arrivalSpread = (k: number) => 1 + 1.6 * (1 - easeInStop(k));

/** "Being watched": 1 = the viewer can see the CORE, 0 = not. Only a fast camera turn or the CORE off screen count as
 *  not watching; the pointer does not (a pointer resting on a planet while reading it must not trigger changes). */
export function watched(angSpeed: number, onScreen: boolean): number {
  if (!onScreen) return 0;
  return 1 - clamp01((Number.isFinite(angSpeed) ? angSpeed : 0) / 0.6); // 0.6 rad/s: a quick pan
}

export type Unseen = { since: number; away: number; n: number };
export const newUnseen = (): Unseen => ({ since: 0, away: 0, n: 0 });
/** One frame of the unseen-change clock: true when the CORE may snap to its next configuration now. Needs the viewer
 *  away for a beat (no snap on one noisy frame) and at least `gap` s since the last change. Mutates `s`. */
export function unseenStep(s: Unseen, dt: number, w: number, gap = 5): boolean {
  const d = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
  s.since += d;
  s.away = w < 0.25 ? s.away + d : 0;
  if (s.away < 0.1 || s.since < gap) return false;
  s.since = 0; s.away = 0; s.n++;
  return true;
}

const TAU = Math.PI * 2;
/** The 4D jump (xw or yw) of an unseen snap, added on top of the slow drift: golden-angle sized, always clearly different. */
export const unseenJump = (plane: 0 | 1) => (plane ? 1.3416 : 2.39996);
/** Wraps an angle to (-pi, pi]: the shortest way back to 0. */
export const wrapAngle = (x: number) => (Number.isFinite(x) ? x - TAU * Math.round(x / TAU) : 0);

/** Off-screen re-seed: true once each time the body leaves the screen. Mutates `s`. */
export function offscreenEdge(s: { off: boolean }, off: boolean): boolean {
  const edge = off && !s.off;
  s.off = off;
  return edge;
}

/** Detuned cluster: n frequency ratios spread over +-cents, symmetric, ready to glide to 1 (unison). */
export function detuneRatios(n: number, cents: number): number[] {
  const m = Math.max(1, Math.floor(n));
  return Array.from({ length: m }, (_, i) => 2 ** (((m === 1 ? 0 : (i / (m - 1)) * 2 - 1) * cents) / 1200));
}
