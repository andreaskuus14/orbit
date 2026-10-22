// Adaptive 3D quality for the galaxy: step down after 3 s under 40 fps, back up after 10 s over 55 fps.
export type QualityMode = "auto" | "high" | "low";
export type QualityLevel = 0 | 1 | 2 | 3; // 0 low (no bloom), 1 medium, 2 high, 3 high + depth of field
// low/high = seconds spent below / above the thresholds; ceil = highest level allowed after a step down (no 60 fps vsync see-saw)
export type QualityState = { level: QualityLevel; low: number; high: number; ceil?: QualityLevel };

export const LOW_FPS = 40, HIGH_FPS = 55, DOWN_AFTER = 3, UP_AFTER = 10;

/** A vsync-halved steady 30 fps (frames a bit over 16.7 ms, e.g. a throttled iGPU on battery): fps within ±3% of 30
 *  and no frame slower than 40 ms. Stepping down can't win back 60 here, so it isn't strain (igloo.inc keeps its effects too). */
export const isCapped = (fps: number, worstMs = 0) => Math.abs(fps - 30) <= 0.9 && worstMs < 40;

/** Feed one averaged FPS sample covering `dt` seconds (worstMs = slowest frame in it); `max` caps how high auto may climb. */
export function stepQuality(s: QualityState, fps: number, dt: number, max: QualityLevel = 2, worstMs = 0): QualityState {
  if (!Number.isFinite(fps) || !Number.isFinite(dt) || dt <= 0 || dt > 2) return s; // tab was hidden or a hitch: no evidence
  const top = Math.min(max, s.ceil ?? max) as QualityLevel;
  const level = Math.min(s.level, max) as QualityLevel;
  const capped = isCapped(fps, worstMs); // healthy: never step down for a cap, and allowed to climb back
  const low = fps < LOW_FPS && !capped ? s.low + dt : 0;
  const high = fps > HIGH_FPS || capped ? s.high + dt : 0;
  if (low >= DOWN_AFTER && level > 0) return { level: (level - 1) as QualityLevel, low: 0, high: 0, ceil: (level - 1) as QualityLevel };
  if (high >= UP_AFTER && level < top) return { level: (level + 1) as QualityLevel, low: 0, high: 0, ceil: s.ceil };
  return { level, low, high, ceil: s.ceil };
}

/** What each level costs. Galaxy reads these; kept here so the numbers are in one place.
 *  dof = depth of field (top level only), film = grain + motion aberration, dust = drifting particles: the first things to go on a step down. */
export const QUALITY = [
  { dpr: 1, stars: 1500, bloom: 0, msaa: 0, belt: 0.35, film: false, dust: 0, dof: false },
  { dpr: 1.25, stars: 3500, bloom: 0.7, msaa: 0, belt: 0.65, film: false, dust: 220, dof: false },
  { dpr: 1.75, stars: 6000, bloom: 0.95, msaa: 4, belt: 1, film: true, dust: 600, dof: false },
  { dpr: 1.75, stars: 6000, bloom: 0.95, msaa: 4, belt: 1, film: true, dust: 600, dof: true }, // galaxy only: DOF is the first thing to go
] as const;

export const parseQualityMode = (v: string | null): QualityMode => (v === "high" || v === "low" ? v : "auto");

/** Worlds use the selected preset; auto starts at medium, like TheaterWorld. */
export const worldQuality = (mode: QualityMode = "auto") => QUALITY[mode === "low" ? 0 : mode === "high" ? 2 : 1];

/** Auto can step down for this world; explicit presets always win. */
export function leanWorldQuality(mode: QualityMode, lean: boolean) {
  const preset = worldQuality(mode === "auto" && lean ? "low" : mode);
  return { dpr: preset.dpr, msaa: preset.msaa, bloomScale: preset.bloom };
}
