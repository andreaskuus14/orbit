// Pure ambient targets. The renderer owns applying them, including exempting LIFE from focus dimming.
export type AmbientMode = "normal" | "focus" | "alert" | "night";
export type AmbientInput = {
  focusRunning: boolean;
  automationFailing: boolean;
  pulseFailed: boolean;
  stopAll: boolean;
  hour: number; // caller's local hour, 0–23
};
export type Ambient = {
  mode: AmbientMode;
  dim: number; // amount of dimming: 0 = unchanged, 1 = fully dimmed
  tint: `#${string}`;
  vignette: number;
  bloomScale: number;
};

const PRESETS: Record<AmbientMode, Ambient> = {
  normal: { mode: "normal", dim: 0, tint: "#ffffff", vignette: 0, bloomScale: 1 },
  focus: { mode: "focus", dim: 0.7, tint: "#ffffff", vignette: 0, bloomScale: 1 },
  alert: { mode: "alert", dim: 0, tint: "#ff4d6d", vignette: 0.35, bloomScale: 1 },
  night: { mode: "night", dim: 0, tint: "#ffd6a3", vignette: 0, bloomScale: 0.7 },
};

/** now is caller-supplied epoch milliseconds; these steady presets need only the explicit local hour.
 * No clock/timezone reads here. Priority: alert > focus > night (23:00 inclusive to 06:00 exclusive) > normal. */
export function ambient(state: AmbientInput, _now: number): Ambient {
  const mode = state.automationFailing || state.pulseFailed || state.stopAll ? "alert"
    : state.focusRunning ? "focus"
    : state.hour >= 23 || state.hour < 6 ? "night" : "normal";
  return { ...PRESETS[mode] };
}

/** Exponential smoothing, dt in seconds. Use for numeric fields, or ease(0, 1, dt) as a color blend weight.
 * About 95% of the distance is covered in one second at normal frame rates. Cap a step at 100 ms so a
 * resumed tab cannot snap to its target; invalid/nonpositive deltas leave the previous value alone. */
export function ease(prev: number, target: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return prev;
  return prev + (target - prev) * -Math.expm1(-3 * Math.min(dt, 0.1));
}
