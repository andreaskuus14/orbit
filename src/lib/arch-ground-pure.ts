// ARCH plot ground (worlds v7): the lawn is no longer a flat disc. It has an irregular rim that rolls down into the cliff,
// a few gentle mounds away from the house, and a colour that varies so the grass texture does not read as tiles.
// Same numbers drive the grass mesh, the rock under it (they share the rim ring, so there is no seam) and the places where
// trees, rocks and ferns stand. Pure: no three.js, so it is tested in node.

const TAU = Math.PI * 2;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Rim radius at angle a for a nominal radius r: wobbles about +-9 %, never a perfect circle. */
export function rimRadius(a: number, r: number): number {
  return r * (1 + 0.05 * Math.sin(3 * a + 1.3) + 0.03 * Math.sin(5 * a + 0.4) + 0.012 * Math.sin(11 * a + 2.1));
}

/** How far the rim rolls down (m) at its edge. */
export const rimDrop = (r: number) => r * 0.14;

/** Height of the ground at normalised radius rho (0 centre, 1 rim) and angle a. Flat near the house, mounds out to 0.9, then rolls down. */
export function groundHeight(rho: number, a: number, r: number): number {
  const mound = 0.22 * sstep(0.5, 0.9, rho) * (Math.sin(a * 2 + rho * 5) * 0.5 + Math.sin(a * 5 - rho * 9 + 1) * 0.35 + Math.sin(a * 3 + rho * 3 + 4) * 0.15);
  const roll = rho > 0.84 ? -rimDrop(r) * Math.pow((rho - 0.84) / 0.16, 2.2) : 0;
  return mound + roll;
}

/** Ground height at a world position (x, z): where to stand a tree. Same function as the mesh, so nothing floats or sinks. */
export function groundY(x: number, z: number, r: number, h: HeightFn = groundHeight): number {
  const a = Math.atan2(z, x), rho = Math.hypot(x, z) / rimRadius(a, r);
  return rho >= 1 ? h(1, a, r) : h(rho, a, r);
}
type HeightFn = (rho: number, a: number, r: number) => number;

/** Meadow colour factor (r, g, b multipliers for the grass texture, which is a dry yellow-brown): lush green in patches of lighter and
 *  darker grass, drier and browner towards the rim. */
export function meadowTint(x: number, z: number, rho: number): [number, number, number] {
  const n = 0.5 + 0.5 * (Math.sin(x * 0.31 + Math.sin(z * 0.23) * 2) * 0.5 + Math.sin(z * 0.37 - x * 0.11 + 1.7) * 0.3 + Math.sin((x + z) * 0.83) * 0.2);
  const rim = sstep(0.75, 1, rho);
  return [0.42 * (0.72 + 0.75 * n) * (1 + 0.2 * rim), (0.66 + 0.5 * n) * (1 - 0.3 * rim), 0.5 * (0.8 + 0.4 * n) * (1 - 0.15 * rim)];
}

export const RINGS = [0, 0.14, 0.28, 0.42, 0.55, 0.66, 0.75, 0.81, 0.86, 0.9, 0.93, 0.96, 0.98, 1];

export type GroundMesh = { pos: Float32Array; col: Float32Array; idx: Uint32Array; rim: number[] };

/** Polar grid: RINGS.length rings of `segs` points (the centre ring collapses to one point), triangles between them. */
export function groundMesh(r: number, segs = 96, height: HeightFn = groundHeight): GroundMesh {
  const n = RINGS.length, pos = new Float32Array((1 + (n - 1) * segs) * 3), col = new Float32Array(pos.length), idx: number[] = [];
  const put = (i: number, x: number, y: number, z: number, rho: number) => { pos.set([x, y, z], i * 3); col.set(meadowTint(x, z, rho), i * 3); };
  put(0, 0, height(0, 0, r), 0, 0);
  const at = (ring: number, s: number) => 1 + (ring - 1) * segs + (s % segs);
  for (let k = 1; k < n; k++) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * TAU, rho = RINGS[k], rad = rimRadius(a, r) * rho;
    put(at(k, s), Math.cos(a) * rad, height(rho, a, r), Math.sin(a) * rad, rho);
  }
  for (let s = 0; s < segs; s++) idx.push(0, at(1, s + 1), at(1, s)); // winding: normals up (+y)
  for (let k = 1; k < n - 1; k++) for (let s = 0; s < segs; s++) {
    const a = at(k, s), b = at(k, s + 1), c = at(k + 1, s), d = at(k + 1, s + 1);
    idx.push(a, b, c, b, d, c);
  }
  const rim = Array.from({ length: segs }, (_, s) => at(n - 1, s));
  return { pos, col, idx: Uint32Array.from(idx), rim };
}

export type RockMesh = { pos: Float32Array; idx: Uint32Array };

/** The cliff body under the lawn: starts exactly on the lawn's rim ring, narrows to 55 % and goes down 0.7 r, rough on the way. */
export function rockMesh(r: number, segs = 96, rows = 6): RockMesh {
  const pos = new Float32Array((rows + 1) * segs * 3), idx: number[] = [];
  const hash = (i: number, j: number) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  for (let j = 0; j <= rows; j++) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * TAU, t = j / rows;
    const k = (1 - 0.45 * t) * (j === 0 ? 1 : 0.9 + 0.2 * hash(s % 24, j)), rad = rimRadius(a, r) * k;
    pos.set([Math.cos(a) * rad, groundHeight(1, a, r) - t * r * 0.7, Math.sin(a) * rad], (j * segs + s) * 3);
  }
  for (let j = 0; j < rows; j++) for (let s = 0; s < segs; s++) {
    const a = j * segs + s, b = j * segs + ((s + 1) % segs), c = (j + 1) * segs + s, d = (j + 1) * segs + ((s + 1) % segs);
    idx.push(a, c, b, b, c, d); // normals point outwards
  }
  return { pos, idx: Uint32Array.from(idx) };
}

/** n spots just inside the rim (fraction of the radius in `band`), spread round the circle, deterministic. */
export function rimSpots(r: number, n: number, band: [number, number], seed = 1): { x: number; z: number; a: number; k: number }[] {
  const hash = (i: number) => { const v = Math.sin((i + seed * 17) * 78.233) * 43758.5453; return v - Math.floor(v); };
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + hash(i) * 0.8) / n) * TAU, rho = band[0] + (band[1] - band[0]) * hash(i + 50), rad = rimRadius(a, r) * rho;
    return { x: Math.cos(a) * rad, z: Math.sin(a) * rad, a, k: hash(i + 100) };
  });
}

/** Scattered spots across the lawn (ring between rho0 and rho1) that keep `gap` metres clear of the house footprint. */
export function meadowSpots(r: number, n: number, fp: { x0: number; x1: number; z0: number; z1: number } | null, gap: number, seed = 3): { x: number; z: number; k: number }[] {
  const hash = (i: number) => { const v = Math.sin((i + seed * 31) * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const out: { x: number; z: number; k: number }[] = [];
  for (let i = 0; out.length < n && i < n * 8; i++) {
    const a = hash(i) * TAU, rho = 0.25 + 0.6 * Math.sqrt(hash(i + 9)), rad = rimRadius(a, r) * rho, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (fp && x > fp.x0 - gap && x < fp.x1 + gap && z > fp.z0 - gap && z < fp.z1 + gap) continue;
    out.push({ x, z, k: hash(i + 77) });
  }
  return out;
}

// ---------- v11: the meadow (the editor's site): open grass with soft swells, a mid tree line that frames the house, a far forest edge ----------

/** Radius (m) of the detailed meadow for a plot: wide enough that its rim is lost in the haze, never under 60 m. */
export const meadowRadius = (plot: { w: number; d: number }) => Math.max(60, Math.max(plot.w, plot.d) * 2.2);

/** Meadow height: dead flat round the house (0.35 r), then soft swells up to ~1.4 m, easing back to 0 at the rim so the far plane joins with no step. */
export function meadowHeight(rho: number, a: number, r: number): number {
  const amp = Math.min(1.4, 0.016 * r) * sstep(0.35, 0.65, rho) * (1 - sstep(0.88, 1, rho));
  return amp * (Math.sin(a * 2 + rho * 4) * 0.55 + Math.sin(a * 5 - rho * 8 + 1) * 0.3 + Math.sin(a * 3 + rho * 2 + 4) * 0.15);
}

export type TreeSpot = { x: number; z: number; kind: "spruce" | "birch" | "pine"; s: number; a: number };
type Rect = { x0: number; x1: number; z0: number; z1: number };
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The trees. `mid`: real trees 24-46 m out (inside radius r), at least 16 m clear of the house and never in the sector the default camera looks
 *  through (camAz = atan2(z, x) of the camera as seen from the house), so they stand behind and beside it. `far` (optional, off by default: the forest edge is drawn by the editor as a texture): cheap trees 0.8-0.97 r all
 *  round. Deterministic. */
export function treePlan(r: number, fp: Rect | null, camAz = Math.PI / 4, nMid = 14, nFar = 0): { mid: TreeSpot[]; far: TreeSpot[] } {
  const hash = (i: number) => { const v = Math.sin(i * 91.7 + 13.13) * 43758.5453; return v - Math.floor(v); };
  const kind = (k: number): TreeSpot["kind"] => (k < 0.5 ? "spruce" : k < 0.78 ? "birch" : "pine");
  const half = fp ? Math.hypot(fp.x1 - fp.x0, fp.z1 - fp.z0) / 2 : 6, cx = fp ? (fp.x0 + fp.x1) / 2 : 0, cz = fp ? (fp.z0 + fp.z1) / 2 : 0;
  const inner = Math.max(half + 20, 0.34 * r), outer = Math.max(inner + 6, 0.7 * r);
  const mid: TreeSpot[] = [];
  for (let i = 0; mid.length < nMid && i < nMid * 12; i++) {
    const a = hash(i) * Math.PI * 2, d = inner + (outer - inner) * Math.sqrt(hash(i + 400)), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (angDiff(a, camAz) < 0.95 && d < 0.62 * r) continue; // keep the camera's side open
    if (mid.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    mid.push({ x, z, kind: kind(hash(i + 800)), s: 0.7 + hash(i + 1200) * 0.35, a });
  }
  const far: TreeSpot[] = Array.from({ length: nFar }, (_, i) => {
    const a = ((i + hash(i + 50) * 0.9) / nFar) * Math.PI * 2, d = r * (0.8 + hash(i + 90) * 0.17);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, kind: kind(hash(i + 130)), s: 1.3 + hash(i + 170) * 0.8, a };
  });
  return { mid, far };
}

/** Bushes and ferns round each mid tree, low and close to the trunk, so the lawn between stays open. */
export function undergrowth(trees: TreeSpot[], per = 3): { x: number; z: number; k: number }[] {
  const out: { x: number; z: number; k: number }[] = [];
  trees.forEach((t, i) => { for (let j = 0; j < per; j++) { const a = (i * 7 + j * 2.1) % (Math.PI * 2), d = 1.6 + ((i * 3 + j) % 5) * 0.55; out.push({ x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d, k: ((i * 5 + j * 3) % 10) / 10 }); } });
  return out;
}

/** The ground beyond the lawn: rings out to `reach` x the rim, flat at 0, coloured by the same function as the lawn so there is no seam; the
 *  first ring is the lawn's own rim ring. Distant rings are coarse (the haze hides them). */
export function farMesh(r: number, segs = 96, rings = [1, 1.25, 1.7, 2.5, 4, 7, 12]): { pos: Float32Array; col: Float32Array; idx: Uint32Array } {
  const n = rings.length, pos = new Float32Array(n * segs * 3), col = new Float32Array(pos.length), idx: number[] = [];
  for (let k = 0; k < n; k++) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * TAU, rad = rimRadius(a, r) * rings[k], i = k * segs + s, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    pos.set([x, 0, z], i * 3); col.set(meadowTint(x, z, 1), i * 3);
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < segs; s++) {
    const a = k * segs + s, b = k * segs + ((s + 1) % segs), c = (k + 1) * segs + s, d = (k + 1) * segs + ((s + 1) % segs);
    idx.push(a, b, c, b, d, c);
  }
  return { pos, col, idx: Uint32Array.from(idx) };
}

export type Silhouette = { x: number; w: number; h: number; conifer: boolean };
/** Tree silhouettes for the forest edge texture (one tile, repeated round the ring): x across 0..1 (wraps), w a fraction of the tile width, h of its height (0.35-0.95). Deterministic. */
export function silhouettes(n = 44, seed = 1): Silhouette[] {
  const hash = (i: number) => { const v = Math.sin((i + seed * 57) * 45.233) * 43758.5453; return v - Math.floor(v); };
  return Array.from({ length: n }, (_, i) => { const conifer = hash(i + 300) < 0.62, h = 0.35 + hash(i + 100) * 0.6; return { x: (i + hash(i) * 0.9) / n, w: (conifer ? 0.05 : 0.07) * h + 0.004, h, conifer }; });
}
