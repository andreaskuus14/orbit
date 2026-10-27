// ARCH "model city" (roadmap 3), pure and tested in tests/arch-site.test.ts: his building on a real-scale plot among neighbour
// blocks. Polygon area / containment / setback inset, site coverage and floor area ratio, and which walls are in a block's shadow.
// Coordinates are the model's own metres: x, z on the ground (the building sits around 0,0). Setbacks, coverage and FAR limits
// come from the local detailed plan (detailplaneering); the numbers here are only what he typed in.
import { isOpening, isStraightWall, type Face, type Part } from "./arch-pure.ts";

export type Pt = [number, number]; // [x, z]
export type Block = { id: string; name: string; x: number; z: number; w: number; d: number; h: number };
export type Setbacks = { street: number; side: number; rear: number };
/** north: compass bearing of true north, degrees clockwise from the model's −Z (seen from above). street: the plot side on the street. */
export type Site = { on: boolean; plot: Pt[]; north: number; street: Face; setback: Setbacks; neighbours: Block[]; draft?: Pt[] | null };
export type Prism = { name: string; poly: Pt[]; top: number };

export const rect = (x: number, z: number, w: number, d: number): Pt[] => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
export const defaultSite = (): Site => ({ on: false, plot: rect(0, 0, 30, 25), north: 0, street: "s", setback: { street: 3, side: 4, rear: 4 }, neighbours: [] });

const signed = (p: Pt[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
export const area = (p: Pt[]) => Math.abs(signed(p));
/** Same polygon wound so that signed() > 0 (outward normal of edge a→b is (dz, −dx)). */
export const wound = (p: Pt[]) => (signed(p) < 0 ? [...p].reverse() : p);
const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;

export function inside([x, z]: Pt, p: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function distToSeg([x, z]: Pt, [ax, az]: Pt, [bx, bz]: Pt): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

const FACE_DIR: Record<Face, Pt> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** Role of each edge of the (wound) plot: the edge facing the street side, the one facing away (rear), the rest sides. */
export function edgeRoles(plot: Pt[], street: Face): ("street" | "side" | "rear")[] {
  const p = wound(plot), [fx, fz] = FACE_DIR[street];
  const dots = p.map((a, i) => { const b = p[(i + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return ((b[1] - a[1]) * fx - (b[0] - a[0]) * fz) / l; });
  const hi = dots.indexOf(Math.max(...dots)), lo = dots.indexOf(Math.min(...dots));
  return dots.map((_, i) => (i === hi ? "street" : i === lo ? "rear" : "side"));
}
export const edgeSetbacks = (plot: Pt[], street: Face, sb: Setbacks) => edgeRoles(plot, street).map((r) => sb[r]);

/** The buildable zone: each edge moved inward by its setback, neighbouring lines intersected. null when the setbacks swallow the plot.
 *  shortcut: line offset, right for convex plots and mild L-shapes; a deep concave plot can self-intersect, use a clipper lib then. */
export function inset(plot: Pt[], d: number[]): Pt[] | null {
  const p = wound(plot), n = p.length;
  if (n < 3 || area(p) < 1e-6) return null;
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
    return { x: a[0] - (ez / l) * d[i], z: a[1] + (ex / l) * d[i], ex, ez };
  });
  const out: Pt[] = lines.map((q, i) => {
    const pl = lines[(i + n - 1) % n], den = cross(pl.ex, pl.ez, q.ex, q.ez);
    if (Math.abs(den) < 1e-9) return [q.x, q.z]; // collinear edges: the offset start point
    const t = cross(q.x - pl.x, q.z - pl.z, q.ex, q.ez) / den;
    return [pl.x + t * pl.ex, pl.z + t * pl.ez];
  });
  // a setback deeper than the plot turns the inset inside out: wrong winding or points that break the distance rule
  if (signed(out) <= 1e-6 || !out.every((pt) => buildable(pt, p, d, 1e-6))) return null;
  return out;
}

/** Inside the plot and at least each edge's setback away from it. */
export function buildable(pt: Pt, plot: Pt[], d: number[], eps = 1e-6): boolean {
  const dist = plot.map((a, i) => distToSeg(pt, a, plot[(i + 1) % plot.length]));
  return (inside(pt, plot) || dist.some((x) => x <= eps)) && dist.every((x, i) => x >= d[i] - eps);
}

// ---- his building ----
/** Ground footprint: walls and slabs (roof eaves and foundations don't count towards coverage or setbacks here). */
const footParts = (parts: Part[]) => parts.filter((p) => p.kind === "wall" || p.kind === "slab");

/** Area of the union of axis-aligned rectangles (coordinate compression; overlaps count once). */
export function unionArea(rs: { x0: number; x1: number; z0: number; z1: number }[]): number {
  const xs = [...new Set(rs.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b), zs = [...new Set(rs.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  let s = 0;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (rs.some((r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1)) s += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]);
  }
  return s;
}

export type SiteStats = { zone: Pt[] | null; plotArea: number; zoneArea: number; footprint: number; floorArea: number; coverage: number; far: number; fits: boolean; outside: string[] };
/** Coverage = footprint / plot area (%). FAR = gross floor area / plot area, each floor's outer wall shell counted once. Fits = every
 *  corner of every wall/slab is in the buildable zone. shortcut: corner test, exact while the zone is convex. */
export function siteStats(parts: Part[], site: Site): SiteStats {
  const plot = wound(site.plot), d = edgeSetbacks(plot, site.street, site.setback), zone = inset(plot, d);
  const fp = footParts(parts), plotArea = area(plot);
  const footprint = unionArea(fp.map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 })));
  const floorArea = parts.filter((p) => p.kind === "wall" && !isStraightWall(p)).reduce((s, p) => s + p.w * p.d, 0);
  const outside = zone ? fp.filter((p) => rect(p.x, p.z, p.w, p.d).some((c) => !buildable(c, plot, d))).map((p) => p.name) : fp.map((p) => p.name);
  return { zone, plotArea, zoneArea: zone ? area(zone) : 0, footprint, floorArea, coverage: plotArea ? (footprint / plotArea) * 100 : 0, far: plotArea ? floorArea / plotArea : 0, fits: !!zone && !outside.length, outside };
}

// ---- sun and shadows ----
/** A sun direction from sunDirection() (+x east, −z north) turned into model axes when true north is `north`° clockwise from −Z. */
export function toModel(dir: { x: number; y: number; z: number }, north: number) {
  const r = (north * Math.PI) / 180, e = dir.x, n = -dir.z;
  return { x: e * Math.cos(r) + n * Math.sin(r), y: dir.y, z: e * Math.sin(r) - n * Math.cos(r) };
}

export const blockPrism = (b: Block): Prism => ({ name: b.name, poly: rect(b.x, b.z, b.w, b.d), top: b.h });
/** His building as shadow casters: every solid part above ground, as a box up to its top (a gable counts as its full box). */
export const buildingPrisms = (parts: Part[]): Prism[] => parts.filter((p) => !isOpening(p.kind) && p.kind !== "foundation").map((p) => ({ name: p.name, poly: rect(p.x, p.z, p.w, p.d), top: p.y + p.h }));

/** Distance along a horizontal ray from o (unit dir r) to where it first enters polygon p; 0 if o is inside; null if it misses. */
function entry(o: Pt, r: Pt, p: Pt[]): number | null {
  if (inside(o, p)) return 0;
  let best: number | null = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], ex = b[0] - a[0], ez = b[1] - a[1], den = cross(r[0], r[1], ex, ez);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(a[0] - o[0], a[1] - o[1], ex, ez) / den, u = cross(a[0] - o[0], a[1] - o[1], r[0], r[1]) / den;
    if (t >= 0 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

/** Share (0..1) of a footprint's sunlit wall faces, sampled every ~1 m at `at` m above ground, that the casters shade. null when
 *  the sun is down. `sun` is in model axes (toModel). shortcut: one sample height, ground-floor windows; add more for upper floors. */
export function shadedShare(target: Pt[], at: number, casters: Prism[], sun: { x: number; y: number; z: number }): number | null {
  if (sun.y <= 0) return null;
  const hl = Math.hypot(sun.x, sun.z), r: Pt = hl ? [sun.x / hl, sun.z / hl] : [0, 0], tanEl = hl ? sun.y / hl : Infinity;
  const p = wound(target);
  let lit = 0, shaded = 0;
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez);
    const nx = ez / l, nz = -ex / l; // outward
    if (!l || nx * r[0] + nz * r[1] <= 0) return; // face turned away from the sun is in its own shade
    const k = Math.max(1, Math.round(l));
    for (let j = 0; j < k; j++) {
      const f = (j + 0.5) / k, o: Pt = [a[0] + ex * f + nx * 0.05, a[1] + ez * f + nz * 0.05];
      lit++;
      if (casters.some((c) => { const s = entry(o, r, c.poly); return s !== null && at + s * tanEl < c.top; })) shaded++;
    }
  });
  return lit ? shaded / lit : null;
}

// ---- presets (street on the +Z side; heights from storeys × ~3 m) ----
const blk = (name: string, x: number, z: number, w: number, d: number, h: number, i: number): Block => ({ id: `n${i}`, name, x, z, w, d, h });
export const PRESETS: { key: string; label: string; site: Omit<Site, "on" | "north"> }[] = [
  { key: "tallinn", label: "Tallinn wooden-house street", site: { plot: rect(0, 0, 18, 30), street: "s", setback: { street: 0, side: 4, rear: 6 }, neighbours: [
    blk("Tallinn house, 3 floors", -18, 8, 12, 14, 11, 1), blk("Tallinn house, 3 floors", 18, 8, 12, 14, 11, 2),
    blk("Across the street", -10, 34, 14, 14, 11, 3), blk("Across the street", 10, 34, 14, 14, 11, 4)] } },
  { key: "kalamaja", label: "Kalamaja", site: { plot: rect(0, 0, 17, 25), street: "s", setback: { street: 0, side: 3, rear: 5 }, neighbours: [
    blk("Wooden house, 2 floors", -15, 8, 10, 9, 8, 1), blk("Wooden house, 2 floors", 15, 8, 10, 9, 8, 2),
    blk("Shed", -15, -8, 6, 4, 3, 3), blk("Shed", 15, -8, 6, 4, 3, 4), blk("Across the street", -8, 27, 10, 9, 8, 5), blk("Across the street", 8, 27, 10, 9, 8, 6)] } },
  { key: "soviet", label: "Soviet block yard", site: { plot: rect(0, 0, 30, 30), street: "s", setback: { street: 5, side: 5, rear: 5 }, neighbours: [
    blk("5-floor block", 0, -31, 60, 12, 15, 1), blk("9-floor block", 33, -5, 12, 60, 27, 2), blk("5-floor block", -33, 0, 12, 40, 15, 3)] } },
];

// ---- stored with the model (localStorage), so read defensively ----
const fin = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
const pt = (v: unknown): Pt | null => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? [v[0], v[1]] : null);
export function readSite(x: unknown): Site {
  const s = defaultSite();
  if (!x || typeof x !== "object") return s;
  const o = x as Record<string, unknown>, sb = (o.setback ?? {}) as Record<string, unknown>;
  const plot = Array.isArray(o.plot) ? o.plot.map(pt).filter((p): p is Pt => !!p).slice(0, 64) : [];
  return {
    on: o.on === true,
    plot: plot.length >= 3 ? plot : s.plot,
    north: fin(o.north, -360, 360, 0),
    street: (["n", "e", "s", "w"] as const).includes(o.street as Face) ? (o.street as Face) : "s",
    setback: { street: fin(sb.street, 0, 50, 3), side: fin(sb.side, 0, 50, 4), rear: fin(sb.rear, 0, 50, 4) },
    neighbours: (Array.isArray(o.neighbours) ? o.neighbours : []).slice(0, 40).flatMap((b, i) => {
      const r = (b ?? {}) as Record<string, unknown>;
      return typeof r.name === "string" ? [{ id: typeof r.id === "string" ? r.id : `n${i}`, name: r.name.slice(0, 60), x: fin(r.x, -200, 200, 0), z: fin(r.z, -200, 200, 0), w: fin(r.w, 0.5, 200, 10), d: fin(r.d, 0.5, 200, 10), h: fin(r.h, 0.5, 200, 8) }] : [];
    }),
  };
}
