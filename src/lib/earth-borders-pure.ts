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
  const g = minDeg > 0 ? minDeg : 0, snap = (v: number) => (g ? Math.round(v / g) * g : v);
  const seen = new Map<string, number>(); // a border two countries share is one line (the busier country's weight)
  const ll: number[] = [], w: number[] = [];
  for (const c of shapes) {
    if (c.name === "Antarctica") continue;
    const k = newsWeight(news[c.name] ?? 0, max);
    for (const ring of c.rings) {
      let lx = snap(ring[0][0]), ly = snap(ring[0][1]), rawX = ring[0][0];
      for (let i = 1; i < ring.length; i++) {
        const x = snap(ring[i][0]), y = snap(ring[i][1]);
        if (x === lx && y === ly) continue;
        const cut = Math.abs(ring[i][0] - rawX) > 180 || (Math.abs(rawX) > 179.9 && Math.abs(ring[i][0]) > 179.9 && Math.sign(rawX) === Math.sign(ring[i][0]));
        rawX = ring[i][0];
        if (!cut) {
          const a = `${lx.toFixed(3)},${ly.toFixed(3)}`, b = `${x.toFixed(3)},${y.toFixed(3)}`, key = a < b ? `${a}|${b}` : `${b}|${a}`, at = seen.get(key);
          if (at === undefined) { seen.set(key, w.length); ll.push(lx, ly, x, y); w.push(k); } else if (k > w[at]) w[at] = k;
        }
        lx = x; ly = y;
      }
    }
  }
  return { lonlat: Float32Array.from(ll), weight: Float32Array.from(w), segments: w.length };
}
