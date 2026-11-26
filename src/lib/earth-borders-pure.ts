// Country borders for the Earth view's glow layer: world-atlas rings → line segments with a news weight per segment (a country with
// stories glows, the rest stays a faint line). Pure; tests/unimap.test.ts.
import type { CountryShape } from "./topo.ts";

export type Borders = { lonlat: Float32Array; weight: Float32Array; segments: number };

/** Weight 0.12 for a country with no stories, 0.45…1 for one with stories (square root of its share of the busiest). */
export function newsWeight(count: number, max: number): number {
  return count > 0 ? 0.45 + 0.55 * Math.sqrt(Math.min(1, count / Math.max(1, max))) : 0.12;
}

/**
 * Segments for every ring: `lonlat` holds a.lon, a.lat, b.lon, b.lat per segment, `weight` one value per segment. Points closer than
 * `minDeg` to the last kept one are dropped (the 50 m atlas is far finer than a screen needs). Segments along the antimeridian cut
 * and Antarctica are skipped, so no false line runs down ±180°.
 */
export function borderLines(shapes: CountryShape[], news: Record<string, number>, minDeg = 0.04): Borders {
  const max = Math.max(1, ...Object.values(news));
  const ll: number[] = [], w: number[] = [];
  for (const c of shapes) {
    if (c.name === "Antarctica") continue;
    const k = newsWeight(news[c.name] ?? 0, max);
    for (const ring of c.rings) {
      let last = ring[0];
      for (let i = 1; i < ring.length; i++) {
        const p = ring[i], end = i === ring.length - 1;
        if (!end && Math.hypot(p[0] - last[0], p[1] - last[1]) < minDeg) continue;
        const cut = Math.abs(p[0] - last[0]) > 180 || (Math.abs(last[0]) > 179.9 && Math.abs(p[0]) > 179.9 && Math.sign(last[0]) === Math.sign(p[0]));
        if (!cut) { ll.push(last[0], last[1], p[0], p[1]); w.push(k); }
        last = p;
      }
    }
  }
  return { lonlat: Float32Array.from(ll), weight: Float32Array.from(w), segments: w.length };
}
