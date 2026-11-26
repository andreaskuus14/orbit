// "Alive" frames: per-plate effect masks (public/worlds/frames/<id>-fx.png, made offline by scripts/frame-scenes/fx.py) and the
// maths the shader uses to move them. Channels: R water (>= .55 waterfall flows down, below that a pond ripples), G foliage sway
// weight (0 base .. 1 tip), B cloud / nebula / smoke drift, A emissive (stored 0.25 + 0.75 v so PNG alpha never eats RGB).
// Pure so the shader constants and the gating are tested. Off under reduced motion and on tier 0 (tier 0 never loads frames).
import type { FrameId, Vec2 } from "./frame-scene-pure.ts";

export type Rotor = { x: number; y: number; r: number; kind: "swirl"; rate: number }; // frame 0..1, radius in frame heights
export type FxParams = { flow: number; ripple: number; sway: number; drift: number; flicker: number; shimmer: number; rotors: Rotor[] };
const NONE: FxParams = { flow: 0, ripple: 0, sway: 0, drift: 0, flicker: 0, shimmer: 0, rotors: [] };

/** Strengths per plate (frame units for displacement, so 0.002 is about 4 px on a 2048 px plate). Subtle on purpose. */
export const FX: Partial<Record<FrameId, FxParams>> = {
  life: { flow: 1, ripple: 0.8, sway: 0.0032, drift: 0.006, flicker: 0.18, shimmer: 0, rotors: [] },
  gamedev: { flow: 1, ripple: 0.7, sway: 0.0026, drift: 0.005, flicker: 0.16, shimmer: 0.4, rotors: [
    { x: 0.762, y: 0.515, r: 0.1, kind: "swirl", rate: 1.0 }] },
  memory: { flow: 1, ripple: 0.5, sway: 0.0018, drift: 0.009, flicker: 0.1, shimmer: 0.55, rotors: [{ x: 0.75, y: 0.1, r: 0.095, kind: "swirl", rate: 0.8 }] },
  arch: { flow: 0, ripple: 1, sway: 0.0024, drift: 0.005, flicker: 0.2, shimmer: 0, rotors: [] },
};
export const hasFx = (id: string): boolean => id in FX;
/** The shader runs only when motion is allowed. */
export const fxOn = (o: { reduced: boolean; tier?: number }): boolean => !o.reduced && (o.tier ?? 1) > 0;
export const fxUrl = (id: string) => `/worlds/frames/${id}-fx.png`;

const c01 = (v: number) => Math.max(0, Math.min(1, v));
const ss = (a: number, b: number, x: number) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** R channel (0..1) -> how much is waterfall (flows down) and how much is pond (ripples). */
export const decodeWater = (r: number): { flow: number; ripple: number } => ({ flow: ss(0.45, 0.6, r) * r, ripple: (1 - ss(0.45, 0.6, r)) * ss(0.04, 0.12, r) });
/** A channel -> emissive weight 0..1 (inverse of the 0.25 + 0.75 v encoding). */
export const decodeEmissive = (a: number): number => c01((a - 0.25) / 0.75);

/** Wind: horizontal displacement of a plant point. w = sway weight (tip 1), depth 0..1 (near moves more), amp in frame units. */
export function wind(t: number, x: number, y: number, w: number, depth: number, amp: number): number {
  const gust = 0.6 + 0.4 * Math.sin(t * 0.37 + x * 3);
  return amp * w * (0.55 + 0.9 * depth) * gust * (Math.sin(t * 1.3 + y * 18 + x * 11) * 0.7 + Math.sin(t * 2.3 + x * 29) * 0.3);
}
/** Two phases half a cycle apart, crossfaded, so a swirl turns for ever without the picture winding into a spiral. */
export function phases(t: number, period = 24): { a: number; b: number; wa: number } {
  const a = (t / period) % 1, b = (a + 0.5) % 1;
  return { a, b, wa: 1 - Math.abs(2 * a - 1) };
}
/** Swirl angle (radians) at radius ratio q = r / R (0 centre .. 1 edge) for a phase 0..1: the core turns most, the rim not at all. */
export const swirlAngle = (q: number, phase: number, rate: number): number => phase * rate * 1.3 * (1 - ss(0.35, 1, q));
/** Emissive gain: lamps flicker with a per-spot phase, crystals shimmer with a band that travels up the plate. */
export function emissiveGain(t: number, e: number, spot: number, y: number, p: Pick<FxParams, "flicker" | "shimmer">): number {
  const fl = Math.sin(t * 7 + spot * 6.28) * Math.sin(t * 3.1 + spot * 17) * p.flicker;
  const band = Math.pow(0.5 + 0.5 * Math.sin(y * 40 - t * 1.6 + spot * 3), 3) * p.shimmer * 0.5;
  return 1 + e * (fl + band);
}
/** Animation is allowed to cost this at most: used by the clip harness to check the frame time. */
export const FX_BUDGET_MS = 16.7;

// ---- the calm grade (design pass): one dominant + one accent colour, less saturation, softer glow, darker edges ----
export type Grade = { sat: number; glow: number; vig: number };
export const GRADE: Record<FrameId, Grade> = {
  vault: { sat: 0.95, glow: 0.9, vig: 0.22 }, operations: { sat: 0.88, glow: 0.8, vig: 0.26 }, business: { sat: 0.72, glow: 0.45, vig: 0.3 },
  agents: { sat: 0.85, glow: 0.7, vig: 0.26 }, memory: { sat: 0.74, glow: 0.5, vig: 0.32 }, analytics: { sat: 0.95, glow: 0.9, vig: 0.22 },
  studio: { sat: 0.74, glow: 0.55, vig: 0.3 }, life: { sat: 0.78, glow: 0.6, vig: 0.28 }, gamedev: { sat: 0.74, glow: 0.5, vig: 0.32 },
  arch: { sat: 1, glow: 1, vig: 0.2 }, core: { sat: 0.85, glow: 0.7, vig: 0.28 },
};
/** Saturation is cut by 20..30 % on the loudest plates and never lifted above 1. */
export const gradeOk = (g: Grade): boolean => g.sat <= 1 && g.sat >= 0.7 && g.glow <= 1 && g.glow >= 0.4 && g.vig >= 0.15 && g.vig <= 0.4;

// ---- world map storms (plate px, 1344 x 752): the painted cyclones turn and morph; the plate's own tint is graded down ----
export const STORM_PLATE = { w: 1344, h: 752 } as const;
export type Storm = { x: number; y: number; r: number; dir: 1 | -1; period: number };
/** Northern cyclones turn anticlockwise, southern ones clockwise (the one at y 470 sits south of the equator line of the plate). */
export function stormsFrom(painted: readonly (readonly [number, number, number])[]): Storm[] {
  return painted.map(([x, y, r], i) => ({ x: x / STORM_PLATE.w, y: y / STORM_PLATE.h, r: r / STORM_PLATE.h, dir: y > 440 ? -1 : 1, period: 26 + i * 5 }));
}
/** Plate calming: desaturate and darken the painted weather tint and the night glow (0 = original, 1 = full). */
export const WORLD_GRADE = { sat: 0.85, tint: 0.55, tintK: 0.8, vig: 0.3 }; // tintK: how far the loud saturated weather colour is pulled to grey
export type { Vec2 };
