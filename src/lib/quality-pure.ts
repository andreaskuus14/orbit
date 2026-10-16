// Adaptive 3D quality for the galaxy: step down after 3 s under 40 fps, back up after 10 s over 55 fps.
export type QualityMode = "auto" | "high" | "low";
export type QualityLevel = 0 | 1 | 2; // 0 low (no bloom), 1 medium, 2 high
// low/high = seconds spent below / above the thresholds; ceil = highest level allowed after a step down (no 60 fps vsync see-saw)
export type QualityState = { level: QualityLevel; low: number; high: number; ceil?: QualityLevel };

export const LOW_FPS = 40, HIGH_FPS = 55, DOWN_AFTER = 3, UP_AFTER = 10;

/** Feed one averaged FPS sample covering `dt` seconds; `max` caps how high auto may climb. */
export function stepQuality(s: QualityState, fps: number, dt: number, max: QualityLevel = 2): QualityState {
  if (!Number.isFinite(fps) || !Number.isFinite(dt) || dt <= 0 || dt > 2) return s; // tab was hidden or a hitch: no evidence
  const top = Math.min(max, s.ceil ?? max) as QualityLevel;
  const level = Math.min(s.level, max) as QualityLevel;
  const low = fps < LOW_FPS ? s.low + dt : 0;
  const high = fps > HIGH_FPS ? s.high + dt : 0;
  if (low >= DOWN_AFTER && level > 0) return { level: (level - 1) as QualityLevel, low: 0, high: 0, ceil: (level - 1) as QualityLevel };
  if (high >= UP_AFTER && level < top) return { level: (level + 1) as QualityLevel, low: 0, high: 0, ceil: s.ceil };
  return { level, low, high, ceil: s.ceil };
}

/** What each level costs. Galaxy reads these; kept here so the numbers are in one place. */
export const QUALITY = [
  { dpr: 1, stars: 1500, bloom: 0, msaa: 0, belt: 0.35 },
  { dpr: 1.25, stars: 3500, bloom: 0.7, msaa: 0, belt: 0.65 },
  { dpr: 1.75, stars: 6000, bloom: 0.95, msaa: 4, belt: 1 },
] as const;

export const parseQualityMode = (v: string | null): QualityMode => (v === "high" || v === "low" ? v : "auto");
