// Frame-based 2.5D worlds (v10): the owner's Higgsfield render is the scene (public/worlds/frames/<id>.webp), a Depth
// Anything V2 Small depth map (<id>-depth.webp) gives it parallax, and live labels sit where the frame had its places.
// All coordinates are normalised to the frame, x right, y DOWN, both 0..1. Pure maths only: the shader and DOM live in
// FrameScene.tsx. Tier 0 and flat mode never load any of this (the procedural world stays the fallback).

export type Spot = { x: number; y: number; d?: number; lod?: 1 | 2 }; // d = depth 0 far .. 1 near (default 0.6)
export const FRAME_IDS = ["vault", "operations", "business", "agents", "memory", "analytics", "studio", "life", "gamedev", "arch", "core"] as const;
export type FrameId = (typeof FRAME_IDS)[number];
export const hasFrame = (id: string): id is FrameId => (FRAME_IDS as readonly string[]).includes(id);

/** Where the places are in each frame (the slots live chips are bound to, in priority order). */
export const SPOTS: Record<FrameId, Spot[]> = {
  vault: [{ x: 0.5, y: 0.47, d: 0.35 }, { x: 0.33, y: 0.38, d: 0.5 }, { x: 0.67, y: 0.38, d: 0.5 }, { x: 0.1, y: 0.35, d: 0.6 }, { x: 0.75, y: 0.3, d: 0.6 },
    { x: 0.12, y: 0.62, d: 0.7 }, { x: 0.74, y: 0.64, d: 0.7 }, { x: 0.5, y: 0.1, d: 0.2 }, { x: 0.5, y: 0.82, d: 0.9 }],
  operations: [{ x: 0.5, y: 0.36, d: 0.5 }, { x: 0.2, y: 0.5, d: 0.6 }, { x: 0.7, y: 0.5, d: 0.6 }, { x: 0.3, y: 0.78, d: 0.8 }, { x: 0.68, y: 0.78, d: 0.8 }, { x: 0.12, y: 0.3, d: 0.5 }, { x: 0.5, y: 0.66, d: 0.7 }, { x: 0.74, y: 0.3, d: 0.4 }],
  agents: [{ x: 0.5, y: 0.3, d: 0.5 }, { x: 0.5, y: 0.82, d: 0.9 }, { x: 0.22, y: 0.35, d: 0.45 }, { x: 0.72, y: 0.35, d: 0.45 }, { x: 0.2, y: 0.65, d: 0.7 }, { x: 0.7, y: 0.65, d: 0.7 }, { x: 0.35, y: 0.55, d: 0.6 }, { x: 0.12, y: 0.5, d: 0.6 }],
  memory: [{ x: 0.5, y: 0.35, d: 0.5 }, { x: 0.25, y: 0.42, d: 0.5 }, { x: 0.72, y: 0.4, d: 0.5 }, { x: 0.15, y: 0.25, d: 0.4 }, { x: 0.38, y: 0.62, d: 0.6 }, { x: 0.66, y: 0.62, d: 0.6 }, { x: 0.5, y: 0.85, d: 0.8 }, { x: 0.58, y: 0.12, d: 0.3 }],
  analytics: [{ x: 0.5, y: 0.2, d: 0.4 }, { x: 0.25, y: 0.45, d: 0.55 }, { x: 0.72, y: 0.45, d: 0.55 }, { x: 0.12, y: 0.65, d: 0.7 }, { x: 0.5, y: 0.55, d: 0.6 }, { x: 0.38, y: 0.78, d: 0.8 }, { x: 0.68, y: 0.75, d: 0.8 }, { x: 0.15, y: 0.3, d: 0.4 }],
  studio: [{ x: 0.5, y: 0.5, d: 0.5 }, { x: 0.25, y: 0.3, d: 0.4 }, { x: 0.7, y: 0.3, d: 0.4 }, { x: 0.12, y: 0.62, d: 0.7 }, { x: 0.68, y: 0.7, d: 0.85 }, { x: 0.3, y: 0.82, d: 0.9 }, { x: 0.45, y: 0.2, d: 0.3 }, { x: 0.18, y: 0.45, d: 0.55 }],
  life: [{ x: 0.52, y: 0.3, d: 0.5 }, { x: 0.3, y: 0.38, d: 0.55 }, { x: 0.72, y: 0.35, d: 0.55 }, { x: 0.4, y: 0.62, d: 0.7 }, { x: 0.68, y: 0.62, d: 0.7 }, { x: 0.15, y: 0.55, d: 0.6 }, { x: 0.5, y: 0.82, d: 0.5 }, { x: 0.12, y: 0.25, d: 0.3 }],
  gamedev: [{ x: 0.5, y: 0.22, d: 0.5 }, { x: 0.15, y: 0.35, d: 0.5 }, { x: 0.72, y: 0.35, d: 0.5 }, { x: 0.3, y: 0.55, d: 0.65 }, { x: 0.65, y: 0.6, d: 0.65 }, { x: 0.12, y: 0.6, d: 0.7 }, { x: 0.5, y: 0.82, d: 0.6 }, { x: 0.45, y: 0.5, d: 0.6 }],
  arch: [{ x: 0.5, y: 0.4, d: 0.5 }, { x: 0.3, y: 0.55, d: 0.6 }, { x: 0.68, y: 0.55, d: 0.6 }, { x: 0.15, y: 0.4, d: 0.4 }, { x: 0.5, y: 0.78, d: 0.8 }, { x: 0.28, y: 0.82, d: 0.85 }, { x: 0.7, y: 0.2, d: 0.3 }, { x: 0.12, y: 0.7, d: 0.8 }],
  core: [{ x: 0.5, y: 0.45, d: 0.5 }, { x: 0.25, y: 0.3, d: 0.4 }, { x: 0.72, y: 0.3, d: 0.4 }, { x: 0.2, y: 0.6, d: 0.5 }, { x: 0.7, y: 0.65, d: 0.5 }, { x: 0.5, y: 0.82, d: 0.5 }, { x: 0.35, y: 0.15, d: 0.3 }],
  business: [{ x: 0.5, y: 0.2, d: 0.55 }, { x: 0.5, y: 0.4, d: 0.6 }, { x: 0.5, y: 0.52, d: 0.65 }, { x: 0.5, y: 0.64, d: 0.7 }, { x: 0.72, y: 0.48, d: 0.6 },
    { x: 0.68, y: 0.7, d: 0.75 }, { x: 0.1, y: 0.47, d: 0.6 }, { x: 0.2, y: 0.62, d: 0.75 }, { x: 0.5, y: 0.82, d: 0.9 }],
};

/** One zoom frame per planet where it exists (zoom-<id>.webp): the level the dolly-in crossfades to. */
export const ZOOM_FRAMES: readonly FrameId[] = ["vault", "operations", "business", "agents", "memory", "analytics", "studio"];

export type Vec2 = [number, number];
/** Cover-fit: screen (0..1) to frame (0..1) is uv = (s - .5) * c + .5. c shrinks the axis that overflows. */
export const coverScale = (frameAspect: number, viewAspect: number): Vec2 =>
  viewAspect > frameAspect ? [1, frameAspect / viewAspect] : [viewAspect / frameAspect, 1];

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const ease = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

/** Parallax shift (frame units) of a point at depth d for a mouse in -1..1. Near moves more than far; d = .5 stays put. */
export const parallax = (mouse: Vec2, d: number, k = 0.022): Vec2 => [mouse[0] * (d - 0.5) * k * 2, mouse[1] * (d - 0.5) * k * 2];

/** Dolly-in: zoom z (1 = whole frame) about focus f, crossfade to the zoom frame over the last part of the move. */
export const dolly = (t: number, zMax = 1.9) => { const e = ease(t); return { z: 1 + (zMax - 1) * e, fade: ease((t - 0.45) / 0.45) }; };

/** Where a spot lands on screen (0..1, y down) given the zoom, focus, mouse and cover-fit. Mirrors the shader. */
export function spotScreen(s: Spot, o: { mouse: Vec2; z: number; focus: Vec2; cover: Vec2; k?: number }): Vec2 {
  const [px, py] = parallax(o.mouse, s.d ?? 0.6, o.k);
  const fx = o.focus[0] + (s.x - o.focus[0]) * o.z - px * o.z, fy = o.focus[1] + (s.y - o.focus[1]) * o.z - py * o.z;
  return [(fx - 0.5) / o.cover[0] + 0.5, (fy - 0.5) / o.cover[1] + 0.5];
}
export const onScreen = (p: Vec2, m = 0.04) => p[0] > -m && p[0] < 1 + m && p[1] > -m && p[1] < 1 + m;

type ChipLike = { id: string; prio?: number; lod?: number };
/** Bind live chips to the frame's slots: most important first, one chip per slot, extras dropped (still reachable in the panel). */
export function bindSpots<C extends ChipLike>(id: FrameId, chips: C[]): { spot: Spot; chip: C }[] {
  const slots = SPOTS[id];
  const sorted = chips.map((c, i) => ({ c, i })).sort((a, b) => (b.c.prio ?? 0) - (a.c.prio ?? 0) || a.i - b.i);
  return sorted.slice(0, slots.length).map((x, i) => ({ spot: slots[i], chip: x.c }));
}

/** Where the dolly-in aims: the slot centre, kept inside the frame so the edge never shows. */
export const focusFor = (s: Spot, zMax = 1.9): Vec2 => { const m = 0.5 / zMax; return [Math.max(m, Math.min(1 - m, s.x)), Math.max(m, Math.min(1 - m, s.y))]; };

/** Life: glow pulse and flicker weights for the emissive mask (pure so the shader constants are tested). */
export const GLOW = { lo: 0.6, hi: 0.9, pulse: 0.16, flicker: 0.05, speed: 1.6 };
export const FRAME_BUDGET_BYTES = 60 * 1024 * 1024;
export const frameUrl = (id: string, kind: "color" | "depth" | "zoom" | "zoom-depth" = "color") =>
  `/worlds/frames/${kind === "color" ? id : kind === "depth" ? `${id}-depth` : kind === "zoom" ? `zoom-${id}` : `zoom-${id}-depth`}.webp`;
