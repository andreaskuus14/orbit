// Alien galaxy theme: the numbers the shader layers need, kept pure so they are testable.

/** Node 0 is the CORE, nodes 1..n the planets in PLANETS order. Every planet links to the CORE and its orbital
 *  neighbour, plus a few long chords so the web reads as a mind, not a wheel. Pairs are unique and never self-links. */
export function filamentPairs(n: number): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    if (a === b || a < 0 || b < 0 || a > n || b > n) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
  };
  for (let i = 1; i <= n; i++) add(0, i);
  for (let i = 1; i < n; i++) add(i, i + 1);
  for (let i = 1; i + 4 <= n; i += 2) add(i, i + 4);
  return out;
}

/** Spiral-arm synapse count per galaxy quality level (0 low .. 3 high). */
export const armCount = (level: number) => [24_000, 60_000, 120_000, 160_000][Math.max(0, Math.min(3, level | 0))];

/** Particles in each planet's thought-cluster shell. */
export const shellCount = (level: number) => [160, 360, 700, 700][Math.max(0, Math.min(3, level | 0))];

const fin = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

/** Gravitational lens: Einstein radius in screen units (fraction of the viewport height) for a lens of world radius
 *  `R` seen from `dist` with vertical field of view `fovDeg`. Clamped so a close CORE never swallows the screen. */
export const einsteinRadius = (R: number, dist: number, fovDeg: number) =>
  fin((R / (Math.max(dist, 1e-3) * Math.tan((fovDeg * Math.PI) / 360))) * 0.5, 0, 0.32);

/** How much close-up detail a world shows, 0 (overview) .. 1 (filling the view): from its size over the camera
 *  distance, capped by quality (level 0: none, 1: half, 2+: all). Drives the extra shader octaves and the LOD mesh. */
export function planetDetail(size: number, dist: number, level: number) {
  const k = fin(size / Math.max(dist, 1e-3), 0, 10); // ~0.03 in the overview, ~0.3 in a close-up
  const t = fin((k - 0.035) / 0.17, 0, 1);
  const cap = [0, 0.5, 1, 1][fin(level | 0, 0, 3)];
  return t * t * (3 - 2 * t) * cap;
}

/** The tesseract rings' 4D rotation angle in the xw (plane 0) or yw (plane 1) plane at time t. Reduced motion holds a
 *  fixed mid-turn frame (still visibly impossible). Returns a number, not a tuple: called every frame, no allocation. */
export const tesseractAngle = (t: number, plane: 0 | 1, reduced: boolean) =>
  reduced ? (plane ? 0.35 : 0.9) : (fin(t, 0, 1e6) * (plane ? 0.137 : 0.23)) % (Math.PI * 2);

/** Overview presence: how much to enlarge a world so its on-screen radius is at least `minFrac` of the viewport's
 *  half-height (fovDeg vertical). 1 when it is already that big (close-ups keep true size); capped at 2.6. */
export function overviewBoost(size: number, dist: number, fovDeg: number, minFrac = 0.032) {
  const frac = size / (Math.max(dist, 1e-3) * Math.tan((fovDeg * Math.PI) / 360));
  return fin(minFrac / Math.max(frac, 1e-6), 1, 2.6);
}

/** How calm the singularity reads, 0 (close-up: full lensing drama) .. 1 (the home overview, ~47 away): the lens,
 *  Einstein ring, disk and inner arms ease down and the shadow disk goes black, so the centre is a crisp dark object. */
export const coreCalm = (dist: number) => {
  const t = fin((dist - 14) / 22, 0, 1);
  return t * t * (3 - 2 * t);
};

/** The CORE artifact's display scale: 1 up close, ~0.62 at the overview so the dark core and its one ring sit well
 *  inside the innermost orbit (c8). The lens, label glare and hit area use the same factor. */
export const coreScale = (dist: number) => 1 - 0.38 * coreCalm(dist);

/** Largest overview boost that keeps a world clear of the CORE: its boosted radius may use at most half the gap
 *  between its orbit and the core's outer ring (`coreR`). Never below 1 (true size always shows). */
export const boostCap = (size: number, orbitR: number, coreR: number) =>
  fin(((orbitR - coreR) * 0.5) / Math.max(size, 1e-3), 1, 2.6);

/** Point sprites below `min` px flicker as they cross pixel centres: draw them at `min` and fade by coverage instead.
 *  Returns [size, alpha factor]; mirrored in the particle shaders (kept here so it is tested). */
export function spriteCoverage(px: number, min = 1.5): [number, number] {
  const s = fin(px, 0, 64);
  return s >= min ? [s, 1] : [min, (s / min) ** 2];
}
