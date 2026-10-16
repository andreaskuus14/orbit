/** LIFE habit ring on the galaxy: pure, clamped numbers only (NaN or huge values black out the Bloom pass). */

export const LIFE_RING_STEPS = 12;
export const LIFE_RING_MAX_GLOW = 1.5;

/** Today's done/total as a fraction in [0, 1]; 0 for no habits, NaN or negatives. */
export function lifeFraction(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done <= 0) return 0;
  return Math.min(1, done / total);
}

/** Fraction snapped to 1/12 steps so the ring geometry rebuilds rarely. Any progress shows one step; only all done is closed. */
export function lifeRingStep(done: number, total: number): number {
  const f = lifeFraction(done, total);
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  return Math.min(LIFE_RING_STEPS - 1, Math.max(1, Math.round(f * LIFE_RING_STEPS))) / LIFE_RING_STEPS;
}

/** Emissive intensity: a gentle pulse only when every habit is done and motion is allowed; always within [0, 1.5]. */
export function lifeRingGlow(step: number, time: number, still: boolean): number {
  const base = 0.5;
  const g = step >= 1 && !still && Number.isFinite(time) ? base + 0.35 * (0.5 + 0.5 * Math.sin(time * 1.6)) : base;
  return Math.min(LIFE_RING_MAX_GLOW, Math.max(0, g));
}
