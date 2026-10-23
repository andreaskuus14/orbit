// ARCH walkthrough + holotable (pure, tested in tests/arch-walk.test.ts): 2D collision against wall footprints for the
// first-person walk, and the holo build front / LIDAR dot grid. Doors are gaps in the wall you can walk through.
import { isOpening, RULES, type Part } from "./arch-pure.ts";

export const WALK = { eye: 1.6, knee: 0.3, radius: 0.25, speed: 3, step: 0.1 };
export type Rect = { x0: number; x1: number; z0: number; z1: number };

/** [a0, a1] minus the gaps, as the pieces left over. */
const cut = (a0: number, a1: number, gaps: [number, number][]) => {
  const out: [number, number][] = [];
  let s = a0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) { if (g0 > s) out.push([s, Math.min(g0, a1)]); s = Math.max(s, g1); }
  if (s < a1) out.push([s, a1]);
  return out.filter(([a, b]) => b - a > 1e-6);
};

/** Footprints that block a walker on the ground: walls spanning knee to eye height. A shell wall is four strips (wallThick),
 *  a thin wall is its own block; doors on a face cut a gap in that strip. */
export function wallRects(parts: Part[]): Rect[] {
  const T = RULES.wallThick, out: Rect[] = [];
  for (const p of parts) {
    if (p.kind !== "wall" || p.y >= WALK.eye || p.y + p.h <= WALK.knee) continue;
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    const gaps = (faces: string[]) => parts.filter((o) => o.kind === "door" && o.host === p.id && faces.includes(o.face ?? ""))
      .map((o): [number, number] => { const c = o.face === "n" || o.face === "s" ? o.x : o.z; return [c - o.w / 2, c + o.w / 2]; });
    const alongX = (za: number, zb: number, f: string[]) => cut(x0, x1, gaps(f)).forEach(([a, b]) => out.push({ x0: a, x1: b, z0: za, z1: zb }));
    const alongZ = (xa: number, xb: number, f: string[]) => cut(z0, z1, gaps(f)).forEach(([a, b]) => out.push({ x0: xa, x1: xb, z0: a, z1: b }));
    if (Math.min(p.w, p.d) <= 2 * T) { if (p.w >= p.d) alongX(z0, z1, ["n", "s"]); else alongZ(x0, x1, ["e", "w"]); }
    else { alongX(z0, z0 + T, ["n"]); alongX(z1 - T, z1, ["s"]); alongZ(x0, x0 + T, ["w"]); alongZ(x1 - T, x1, ["e"]); }
  }
  return out;
}

export const collides = (x: number, z: number, rects: Rect[], r = WALK.radius) =>
  rects.some((q) => x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r);

/** Move by (dx, dz) in small sub-steps (no tunnelling through a 0.2 m wall), sliding along walls axis by axis, kept on the plot. */
export function moveWalker(x: number, z: number, dx: number, dz: number, rects: Rect[], plot: { w: number; d: number }): { x: number; z: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return { x, z };
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / WALK.step)), hx = plot.w / 2 - WALK.radius, hz = plot.d / 2 - WALK.radius;
  for (let i = 0; i < n; i++) {
    const stuck = collides(x, z, rects); // already inside a wall (it was moved onto him): let him walk out
    const nx = Math.max(-hx, Math.min(hx, x + dx / n));
    if (stuck || !collides(nx, z, rects)) x = nx;
    const nz = Math.max(-hz, Math.min(hz, z + dz / n));
    if (stuck || !collides(x, nz, rects)) z = nz;
  }
  return { x, z };
}

/** Where the walk starts: just inside a plot edge, facing the middle (yaw 0 = looking toward −Z). */
export function walkStart(plot: { w: number; d: number }, rects: Rect[]): { x: number; z: number; yaw: number } {
  const e = 1.5, spots: [number, number][] = [[0, plot.d / 2 - e], [0, -plot.d / 2 + e], [plot.w / 2 - e, 0], [-plot.w / 2 + e, 0], [0, 0]];
  const [x, z] = spots.find(([a, b]) => !collides(a, b, rects)) ?? spots[0];
  return { x, z, yaw: Math.atan2(x, z) };
}

export const HOLO_START = 0.6, HOLO_STEP = 0.45; // same timing as the ▶ Build animation in ArchWorld
export const NO_FRONT = 1e4;
/** Height the hologram has been "printed" up to: each solid part (sorted bottom to top) fills from its base to its top during its
 *  build step. Above it nothing is drawn. NO_FRONT once the build is done. No allocations: called every frame. */
export function buildFront(solid: Part[], elapsed: number, t0: number): number {
  const t = elapsed - t0 - HOLO_START;
  if (!solid.length || !(t < solid.length * HOLO_STEP)) return NO_FRONT; // also NaN
  let f = solid[0].y;
  for (let i = 0; i < solid.length; i++) {
    const k = (t - i * HOLO_STEP) / HOLO_STEP;
    if (k <= 0) break;
    const p = solid[i];
    if (!isOpening(p.kind)) f = Math.max(f, p.y + p.h * Math.min(1, k));
  }
  return f;
}

/** LIDAR dots on the holotable disc, flat [x, y, z, …], at most ~20k points however big the plot. */
export function lidarDots(radius: number, y = 0.01): Float32Array {
  const r = Math.max(0, Math.min(radius, 400)), step = Math.max(1, Math.ceil(r / 70)), out: number[] = [];
  for (let x = -Math.floor(r / step) * step; x <= r; x += step)
    for (let z = -Math.floor(r / step) * step; z <= r; z += step) if (x * x + z * z <= r * r) out.push(x, y, z);
  return new Float32Array(out);
}
