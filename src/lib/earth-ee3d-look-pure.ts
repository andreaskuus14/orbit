// Estonia close-up look: wall colours and where trees stand. Pure, tested in tests/earth-ee3d.test.ts.

// Plaster tones of Estonian towns (linear RGB): old-town ochre, cream, salmon, pale green, pale blue, white; wooden-house
// yellow and ox-blood red; taller buildings (> 18 m) take the light greys and off-whites of post-war and modern blocks.
const LOW = ["#e3d2a8", "#d8b46a", "#e0a98f", "#bfcba0", "#aebfc9", "#ece6d8", "#d7c27a", "#9a4b3c", "#c9b8a0", "#e8dcc4"];
const TALL = ["#d9d7d0", "#c6c8c8", "#e6e2d8", "#b9bcbf", "#d2cbbd"];
const lin = (h: string): [number, number, number] => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255) ** 2.2) as [number, number, number];
const hash = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
// Medieval old towns (Tallinn, Tartu): warmer limewash, ochre, cream, pink, apricot, pale green, the odd white.
const OLD = ["#e2b45c", "#efe1bf", "#e8b0a0", "#c3d6a8", "#eac08a", "#f0d98c", "#dc9a80", "#f3ede0", "#d9a86c", "#cfdcb4", "#f1c9b5"];
const OLD_BOX: [number, number, number, number][] = [[24.7375, 59.4325, 24.7535, 59.4415], [26.7140, 58.3765, 26.7280, 58.3845]]; // w s e n
/** True inside a medieval old town (its walls get the warm palette). */
export const oldTown = (lon: number, lat: number) => OLD_BOX.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
/** A building's wall colour from a stable seed and its height (m); old-town buildings take the warm palette. Each building's tone
 *  is a little lighter or darker (±8 %) so neighbours with the same paint still read apart. */
export function wallTint(seed: number, height: number, old = false): [number, number, number] {
  const p = old && height < 30 ? OLD : height > 18 ? TALL : LOW, k = 0.92 + 0.16 * hash(seed ^ 0x5bd1e995);
  return lin(p[Math.floor(hash(seed) * p.length)]).map((v) => Math.min(1, v * k)) as [number, number, number];
}

export type Tree = { u: number; v: number; r: number; h: number; c: [number, number, number] };
/** A pixel that reads as a tree crown in the orthophoto: green over red and blue, darker than fields and lawns. */
export function isCrown(r: number, g: number, b: number): boolean {
  const s = r + g + b;
  return g > r * 1.06 && g >= b * 1.02 && s > 60 && s < 330 && g - Math.min(r, b) > 8;
}
/**
 * Trees from the orthophoto (rgba, W×W px over one tile): every `step` px, a crown pixel with mostly crown pixels around it and
 * no roof under it becomes a tree (position in tile units 0..1, radius and height in metres, colour of the photo, linear). Lawns
 * and fields are lighter and fail the test; a small jitter keeps rows from looking planted. At most `max` trees.
 */
export function treeSpots(px: Uint8ClampedArray | Uint8Array, W: number, roof: Uint8Array, step: number, mPerPx: number, max = 6000): Tree[] {
  const out: Tree[] = [], r = Math.max(2, Math.round(step / 2));
  for (let y = r; y < W - r; y += step) for (let x = r; x < W - r; x += step) {
    const j = hashXY(x, y), xx = Math.min(W - 1, x + Math.round((j - 0.5) * step * 0.8)), yy = Math.min(W - 1, y + Math.round((hashXY(y, x) - 0.5) * step * 0.8));
    if (roof[yy * W + xx]) continue;
    let n = 0, cr = 0, cg = 0, cb = 0, k = 0;
    for (let dy = -r; dy <= r; dy += r) for (let dx = -r; dx <= r; dx += r) {
      const X = Math.min(W - 1, Math.max(0, xx + dx)), Y = Math.min(W - 1, Math.max(0, yy + dy)), i = (Y * W + X) * 4; k++;
      if (isCrown(px[i], px[i + 1], px[i + 2]) && !roof[Y * W + X]) { n++; cr += px[i]; cg += px[i + 1]; cb += px[i + 2]; }
    }
    if (n < 6) continue; // 6 of 9 samples: a real crown, not a green car or a lawn edge
    const rad = Math.max(1.8, Math.min(5.5, step * mPerPx * (0.55 + 0.35 * j)));
    out.push({ u: xx / W, v: yy / W, r: rad, h: rad * (2.2 + 1.4 * hashXY(xx + 7, yy)), c: [cr / n / 255, cg / n / 255, cb / n / 255].map((v) => (v * 0.95) ** 2.2) as [number, number, number] });
    if (out.length >= max) return out;
  }
  return out;
}
function hashXY(x: number, y: number) { return hash(Math.imul(x, 73856093) ^ Math.imul(y, 19349663)); }

/** Distance (in tiles) from point fx,fy to the nearest tile around it that is not ready: the loaded area's inner radius. */
export function coveredRadius(fx: number, fy: number, ready: (x: number, y: number) => boolean, reach = 4): number {
  let best = reach;
  for (let y = Math.floor(fy) - reach; y <= Math.floor(fy) + reach; y++) for (let x = Math.floor(fx) - reach; x <= Math.floor(fx) + reach; x++) {
    if (ready(x, y)) continue;
    const dx = Math.max(x - fx, 0, fx - (x + 1)), dy = Math.max(y - fy, 0, fy - (y + 1));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
