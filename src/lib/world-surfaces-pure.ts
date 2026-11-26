// Pure maths for the v6 world surfaces: the waterfall's path, crystal clusters, and mountain height from a heightmap.
// The shaders and meshes live in src/components/world-surfaces.tsx.

export type V3 = [number, number, number];

/** Points of a falling-water ribbon: flat out over the lip, then a ballistic drop (x stays, z keeps going, y falls).
 *  lip = where the river leaves the edge, push = how far it shoots out, drop = how far down it goes. n + 1 points. */
export function fallPath(lip: V3, push: number, drop: number, n = 24): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push([lip[0], lip[1] - drop * t * t, lip[2] + push * Math.sqrt(t) * (1 + 0.15 * t)]); }
  return out;
}

const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

export type Crystal = { at: V3; h: number; w?: number; tilt?: [number, number]; color: string; glow?: number };
/** One crystal becomes a cluster: the main one plus `extra` smaller ones leaning out round its foot (deterministic). */
export function crystalCluster(c: Crystal, seed: number, extra = 3): Crystal[] {
  const w = c.w ?? c.h * 0.35, out: Crystal[] = [c];
  for (let i = 0; i < extra; i++) {
    const a = (i / extra) * Math.PI * 2 + hash(seed + i) * 1.2, r = w * (0.55 + hash(seed * 3 + i) * 0.35), k = 0.32 + hash(seed * 7 + i) * 0.3;
    const lean = 0.35 + hash(seed * 11 + i) * 0.35;
    out.push({ at: [c.at[0] + Math.cos(a) * r, c.at[1] - c.h * 0.02, c.at[2] + Math.sin(a) * r], h: c.h * k, w: w * k * 1.1,
      tilt: [Math.sin(a) * lean, -Math.cos(a) * lean], color: c.color, glow: (c.glow ?? 1) * 0.8 });
  }
  return out;
}

/** Bilinear sample of a grey heightmap (values 0..1, row-major, size × size) at u, v in 0..1 (wraps). */
export function sampleHeight(data: ArrayLike<number>, size: number, u: number, v: number): number {
  const x = (((u % 1) + 1) % 1) * (size - 1), y = (((v % 1) + 1) % 1) * (size - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const g = (i: number, j: number) => data[j * size + i];
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
}

/** Height of a mountain range at (u, v) in 0..1 across its patch: a ridge along u, the heightmap for the rock detail,
 *  falling to 0 at every edge so the patch sits in the water without a seam. 0..1. */
export function mountainHeight(detail: number, u: number, v: number, seed = 0): number {
  const ridge = Math.exp(-Math.pow((v - 0.5 - 0.08 * Math.sin(u * 7 + seed)) * 3.2, 2));
  const peaks = 0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * (2 + (seed % 2)) + seed));
  const edge = Math.min(1, u * 5, (1 - u) * 5, v * 5, (1 - v) * 5);
  return Math.max(0, ridge * peaks * (0.65 + 0.7 * detail) * Math.max(0, edge));
}
