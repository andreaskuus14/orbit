// Depth parallax for the frame plates: a depth map (white = near) shifts each pixel against the pointer, so the plate leans like a
// real scene. Pure maths here; the GL draw is in components/intel/plate-gl.ts.

/** Strength of the shift (fraction of the plate width at full pointer travel) per plate: wide views barely move, close ones lean. */
export const PARALLAX: Record<string, number> = { world: 0.006, europe: 0.014, estonia: 0.016, tallinn: 0.022, village: 0.022 };

/** Pointer position in a box (px) -> -1..1 on both axes, clamped. */
export function pointerNorm(x: number, y: number, w: number, h: number): [number, number] {
  const c = (v: number) => Math.max(-1, Math.min(1, v));
  return [c((x / Math.max(1, w)) * 2 - 1), c((y / Math.max(1, h)) * 2 - 1)];
}

/** Ease the shown offset toward the pointer; dt in seconds. */
export function easeOffset(cur: [number, number], target: [number, number], dt: number, rate = 5): [number, number] {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return [cur[0] + (target[0] - cur[0]) * k, cur[1] + (target[1] - cur[1]) * k];
}

/** UV shift of a pixel with depth d (0..1, 1 near) for an offset in -1..1: near pixels move against the pointer, far ones stay. */
export function shiftFor(d: number, off: [number, number], strength: number): [number, number] {
  const z = d - 0.5;
  return [-off[0] * z * strength * 2, -off[1] * z * strength * 2];
}
