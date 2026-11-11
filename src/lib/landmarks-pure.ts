// Landmarks: each world's signature 3D building (Higgsfield SAM 3D from an approved concept, slimmed to ~4k triangles,
// public/planets/landmarks/<id>.glb) stands on its surface a few times, spread out and clear of the poles.
// Placement is deterministic per world so the planets look the same every visit. Tests: tests/landmarks.test.ts.
export const LANDMARKS = ["memory", "intelligence", "creation", "operations", "agents", "life", "vault", "analytics", "studio", "theater", "markets", "business"] as const;
export const hasLandmark = (id: string): boolean => (LANDMARKS as readonly string[]).includes(id);

const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** n unit directions on the sphere: latitude within ±55° (no buildings on the ice caps), at least `minDeg` apart. */
export function spots(seed: number, n: number, minDeg = 38): [number, number, number][] {
  const r = rng(Math.max(1, Math.floor(seed * 9973) % 2147483646)), out: [number, number, number][] = [], cos = Math.cos((minDeg * Math.PI) / 180);
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const lat = (r() * 2 - 1) * (55 * Math.PI) / 180, lon = r() * Math.PI * 2;
    const d: [number, number, number] = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    if (out.every((o) => o[0] * d[0] + o[1] * d[1] + o[2] * d[2] < cos)) out.push(d);
  }
  return out;
}

export type Building = { d: [number, number, number]; scale: number; turn: number };
/** Towns: `n` town centres (spots), each a cluster of `per` buildings scattered within a few degrees of it, one big
 *  centrepiece and smaller neighbours, every one turned its own way. ~30 buildings a world by default. */
export function towns(seed: number, n = 5, per = 6, spreadDeg = 9): Building[] {
  const r = rng(Math.max(1, Math.floor(seed * 7919) % 2147483646)), out: Building[] = [], sp = (spreadDeg * Math.PI) / 180;
  for (const c of spots(seed, n, 32)) {
    // a tangent frame at the town centre
    const t = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(t, c)), v = cross(c, u);
    for (let i = 0; i < per; i++) {
      const a = r() * Math.PI * 2, rad = i === 0 ? 0 : sp * (0.35 + 0.65 * Math.sqrt(r()));
      const d = norm([0, 1, 2].map((k) => c[k] * Math.cos(rad) + (u[k] * Math.cos(a) + v[k] * Math.sin(a)) * Math.sin(rad)) as [number, number, number]);
      out.push({ d, scale: i === 0 ? 1 : 0.35 + 0.4 * r(), turn: r() * Math.PI * 2 });
    }
  }
  return out;
}
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]): [number, number, number] => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
