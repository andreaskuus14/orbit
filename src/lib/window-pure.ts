import type { PanelId } from "./planets";

// Window planets and the through-the-surface entry (impossible-research #3, #4): which ONE planet is a window, how its
// portal blends in and out, the screen box its interior is rendered for, and the dive's distance and FOV over time.
// No allocations; every output is finite.

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** The camera is "near" a world inside this many radii (a focused planet sits ~4.5-8 radii away). */
export const NEAR_RADII = 7;

/** The one window: a dive wins, then the hovered planet, then the nearest planet if the camera is close to it. */
export function windowTarget<T extends string>(dive: T | null, hover: T | null, nearest: T | null, nearRadii: number): T | null {
  if (dive) return dive;
  if (hover) return hover;
  return nearest && Number.isFinite(nearRadii) && nearRadii < NEAR_RADII ? nearest : null;
}

export type WindowState<T extends string = string> = { id: T | null; k: number };

/** One step of the portal blend (tau 0.1 s: ~300 ms to settle). Only one portal is live: a new target waits until the
 *  old one has faded out, unless `snap` (a dive) switches at once. */
export function stepWindow<T extends string>(s: WindowState<T>, target: T | null, dt: number, tau = 0.1, snap = false): WindowState<T> {
  if (s.id !== target && (s.id === null || s.k < 0.01 || snap)) { s.id = target; s.k = 0; }
  const goal = s.id !== null && s.id === target ? 1 : 0;
  const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  s.k = clamp01(goal + (clamp01(s.k) - goal) * Math.exp(-step / tau));
  if (goal === 1 && s.k > 0.995) s.k = 1;
  if (goal === 0 && s.k < 0.005) { s.k = 0; s.id = null; }
  return s;
}

export type Crop = { x: number; y: number; w: number; h: number; ok: boolean };

/** The screen box (NDC centre + half size) the interior is rendered for: the sphere's projected bounds, clipped to the
 *  screen, so the 256² target is spent on the planet, not on empty sky. `dz` = view depth of the centre, `r` = radius,
 *  `p0`/`p5` = the projection's x/y scale. Close up (or inside) it is the whole screen. */
export function windowCrop(cx: number, cy: number, dz: number, r: number, p0: number, p5: number, out: Crop): Crop {
  out.ok = false; out.x = 0; out.y = 0; out.w = 1; out.h = 1;
  if (![cx, cy, dz, r, p0, p5].every(Number.isFinite) || r <= 0) return out;
  if (dz < -r) return out; // behind the camera
  if (dz <= r * 1.2) { out.ok = true; return out; } // inside or about to cross: full screen
  const s = (r / Math.sqrt(dz * dz - r * r)) * (1.15 + 0.5 * Math.hypot(cx, cy) * (r / dz)); // tangent cone + off-axis stretch
  const hx = Math.abs(p0) * s, hy = Math.abs(p5) * s;
  const x0 = Math.max(-1, cx - hx), x1 = Math.min(1, cx + hx), y0 = Math.max(-1, cy - hy), y1 = Math.min(1, cy + hy);
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return out; // off screen
  out.x = (x0 + x1) / 2; out.y = (y0 + y1) / 2; out.w = (x1 - x0) / 2; out.h = (y1 - y0) / 2; out.ok = true;
  return out;
}

/** The dive: the surface is crossed at DIVE_CROSS s, the camera settles inside at DIVE_SECS. The world then crossfades in
 *  over DIVE_FADE s: ~1.1 s in all, as long as the old warp. */
/** A fresh object identifies each request, even when a rapid A → B → A retarget ends on the same planet. */
export type DiveRequest = { id: PanelId };

export const DIVE_CROSS = 0.7, DIVE_SECS = 0.95, DIVE_FADE = 0.4;
const INSIDE = 0.35; // where the camera comes to rest, in radii from the centre

/** Camera distance from the centre, in radii, `t` s into a dive that started `r0` radii out. Outside it closes the gap
 *  geometrically (the planet grows at a steady rate on screen) and speeds up; it reaches 1 exactly at DIVE_CROSS. */
export function diveRadii(t: number, r0: number): number {
  const a = Number.isFinite(r0) ? Math.max(0, r0) : 1.05;
  const tt = Number.isFinite(t) ? Math.max(0, t) : 0;
  if (tt < DIVE_CROSS) {
    const x = tt / DIVE_CROSS, u = x * (0.35 + 0.65 * x); // ease-in: speed only grows toward the surface
    return a < 1 ? a + (1 - a) * u : Math.pow(a, 1 - u);
  }
  const x = clamp01((tt - DIVE_CROSS) / (DIVE_SECS - DIVE_CROSS)), u = 1 - (1 - x) * (1 - x); // inside: settle
  return Math.pow(INSIDE, u);
}

/** Reverse dolly zoom: the FOV widens while the camera moves in, so space stretches away around the planet. */
export function diveFov(t: number, fov0: number): number {
  const f = Number.isFinite(fov0) ? Math.min(90, Math.max(20, fov0)) : 50;
  const x = clamp01((Number.isFinite(t) ? t : 0) / DIVE_CROSS), s = x * x * (3 - 2 * x);
  return f + (Math.max(f, 82) - f) * s;
}
