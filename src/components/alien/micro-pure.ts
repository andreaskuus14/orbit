// Pure numbers for the planets' micro-worlds (MicroWorld.tsx): budgets, reveal ramps, the x-ray lens. No three.js.
const fin = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
const ss = (a: number, b: number, x: number) => { const t = fin((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Surface structures per world for a quality level (0 = none). */
export const structureBudget = (level: number) => [0, 2500, 7000, 9000][fin(level | 0, 0, 3)];

/** Closeness k = world radius / camera distance (~0.03 overview, ~0.17 an opened world, ~0.74 the closest approach) ->
 *  what is shown. far: nothing; mid (an opened world): the biggest structures, city glow, the orbital ring; close: every
 *  structure, streets, traffic, climbers and ships. `show` is the structures' rank threshold (big ones rank first); it
 *  runs past 1 so the last ranks finish growing. Level 1 stops at the larger part of the set. */
export type MicroStage = { show: number; city: number; orbit: number; traffic: number };
export const newStage = (): MicroStage => ({ show: 0, city: 0, orbit: 0, traffic: 0 });
export function microStage(k: number, level: number, out: MicroStage = newStage()) { // pass `out` per frame: no allocation
  const c = fin(k, 0, 10), on = level > 0 ? 1 : 0;
  out.show = ss(0.1, 0.5, c) * 1.12 * (level >= 2 ? 1 : 0.6) * on;
  out.city = ss(0.05, 0.15, c) * on;
  out.orbit = ss(0.045, 0.09, c) * on;
  out.traffic = ss(0.12, 0.3, c) * (level >= 2 ? 1 : 0);
  return out;
}

/** How many of the rank-sorted (ascending) instances have started to grow at threshold `show`: draw only those. */
export function rankCount(ranks: ArrayLike<number>, show: number) {
  let lo = 0, hi = ranks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ranks[m] < show) lo = m + 1; else hi = m; }
  return lo;
}

/* A JS twin of the GLSL h33/h13/gnoise/fbm/famSite in LiquidPlanet.tsx (keep them in step): structures are placed once,
   on the CPU, where the surface shader's famSite puts its cities, so no vertex re-evaluates noise every frame. */
type V3 = [number, number, number];
const fr = (x: number) => x - Math.floor(x);
const H = [0, 0, 0]; // h33's output (placement runs ~10^5 noise calls: no array per call)
function h33(x: number, y: number, z: number) {
  x = fr(x * 0.1031); y = fr(y * 0.103); z = fr(z * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  H[0] = fr((x + y) * z); H[1] = fr((x + x) * y); H[2] = fr((y + x) * x);
  return H;
}
function h13(x: number, y: number, z: number) {
  x = fr(x * 0.1031); y = fr(y * 0.1031); z = fr(z * 0.1031);
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  x += d; y += d; z += d;
  return fr((x + y) * z);
}
const quint = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function grad(ix: number, iy: number, iz: number, fx: number, fy: number, fz: number, ox: number, oy: number, oz: number) {
  const h = h33(ix + ox, iy + oy, iz + oz);
  return (h[0] * 2 - 1) * (fx - ox) + (h[1] * 2 - 1) * (fy - oy) + (h[2] * 2 - 1) * (fz - oz);
}
function gnoise(px: number, py: number, pz: number) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz), fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = quint(fx), uy = quint(fy), uz = quint(fz);
  const g = (ox: number, oy: number, oz: number) => grad(ix, iy, iz, fx, fy, fz, ox, oy, oz);
  return lerp(lerp(lerp(g(0, 0, 0), g(1, 0, 0), ux), lerp(g(0, 1, 0), g(1, 1, 0), ux), uy), lerp(lerp(g(0, 0, 1), g(1, 0, 1), ux), lerp(g(0, 1, 1), g(1, 1, 1), ux), uy), uz);
}
function fbm(x: number, y: number, z: number, oct: number) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < 8; i++) {
    const k = fin(oct - i, 0, 1);
    if (k <= 0) break;
    s += a * k * gnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5;
    const t = x; x = y + 1.7; y = z - 2.3; z = t + 0.9;
  }
  return s;
}
/** Where the micro-world lives on unit direction n (0..~1.1), for pattern family `fam` (-1 chrome) and seed `sd`. */
export function famSite(n: V3, fam: number, sd: V3) {
  const [nx, ny, nz] = n, qx = nx + sd[0], qy = ny + sd[1], qz = nz + sd[2];
  if (fam < -0.5) return ss(-0.05, 0.2, fbm(nx * 2.2 + 3.1, ny * 2.2 + 0.7, nz * 2.2 - 1.9, 3));
  if (fam < 0.5) {
    const wv = fbm(qx * 2.4, qy * 2.4, qz * 2.4, 3), y = ny + wv * 0.13;
    const b = 0.5 + 0.5 * Math.sin(y * 15 + Math.sin(y * 5 + sd[0]) * 1.8);
    return Math.exp(-(((b - 0.5) * 4) ** 2)) * (1 - ss(0.7, 0.92, Math.abs(ny)));
  }
  if (fam < 1.5) {
    const wx = fbm(qx * 1.7, qy * 1.7, qz * 1.7, 3), wy = fbm(qx * 1.7 + 5.2, qy * 1.7 + 5.2, qz * 1.7 + 5.2, 3);
    const m = fbm(qx * 2.1 + wx * 2.4, qy * 2.1 + wy * 2.4, qz * 2.1, 4);
    return 1 - ss(0.03, 0.16, Math.abs(m - 0.08));
  }
  if (fam < 2.5) {
    const cx = qx * 4, cy = qy * 4, cz = qz * 4, ix = Math.floor(cx), iy = Math.floor(cy), iz = Math.floor(cz);
    let d1 = 8, id: V3 = [0, 0, 0];
    for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const h = h33(ix + x, iy + y, iz + z); // read before the next h33 call overwrites it
      const rx = x + h[0] * 0.8 + 0.1 - (cx - ix), ry = y + h[1] * 0.8 + 0.1 - (cy - iy), rz = z + h[2] * 0.8 + 0.1 - (cz - iz);
      const d = rx * rx + ry * ry + rz * rz;
      if (d < d1) { d1 = d; id = [ix + x, iy + y, iz + z]; }
    }
    const rad = 0.18 + 0.22 * h13(id[0] * 1.7, id[1] * 1.7, id[2] * 1.7), d = Math.sqrt(d1) / rad;
    return Math.exp(-(((d - 1.08) * 5) ** 2)) * (h13(id[0] + 3.1, id[1] + 3.1, id[2] + 3.1) >= 0.45 ? 1 : 0) + 0.12;
  }
  const land = fbm(qx * 1.9, qy * 1.9, qz * 1.9, 5);
  return ss(0.05, 0.14, land) * (1 - ss(0.66, 0.78, Math.abs(ny) + land * 0.15));
}

/** JS twin of the shader's cityDens: famSite in distinct clusters (0..1). Structures stand where the night lights are. */
export function cityDensity(n: V3, fam: number, sd: V3) {
  const k = 0.2 + 1.3 * ss(-0.05, 0.3, fbm(n[0] * 6 + sd[0] * 3, n[1] * 6 + sd[1] * 3, n[2] * 6 + sd[2] * 3, 3));
  return k * 1.15 <= 0.25 ? 0 : ss(0.25, 0.7, famSite(n, fam, sd) * k); // famSite <= 1.12: skip it where no city can be
}

/** The x-ray lens radius on the unit sphere for a world `planetPx` pixels in radius: about `wantPx` on screen. */
export const lensRadius = (planetPx: number, wantPx = 120) => (planetPx > 1 ? fin(wantPx / planetPx, 0.05, 0.75) : 0.75);
