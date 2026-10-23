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
