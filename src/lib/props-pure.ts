// Surface props: every world is covered in small themed things (crystal shards, trees, volcanoes, rocks...) between its
// landmark towns. Deterministic per world, spread over the sphere off the poles, kept clear of the towns. Rendering:
// components/alien/SurfaceProps.tsx. Tests: tests/props-pure.test.ts.
import { towns } from "./landmarks-pure.ts";

export type PropKind = "crystal" | "rock" | "islet" | "boulder" | "block" | "pylon" | "vent" | "house" | "conifer" | "tree" | "bush" | "shard" | "volcano" | "jade";
/** Each world's kinds with their share of the props; gas giants (analytics, theater) and arch get none. */
export const PROPS: Record<string, [PropKind, number][]> = {
  memory: [["crystal", 0.75], ["rock", 0.25]],
  intelligence: [["islet", 1]],
  creation: [["boulder", 0.6], ["block", 0.4]],
  operations: [["pylon", 0.45], ["vent", 0.55]],
  agents: [["house", 0.8], ["rock", 0.2]],
  life: [["conifer", 0.45], ["tree", 0.35], ["bush", 0.2]],
  vault: [["shard", 0.8], ["rock", 0.2]],
  studio: [["volcano", 0.35], ["rock", 0.65]],
  markets: [["jade", 1]],
  business: [["rock", 0.5], ["tree", 0.5]],
};
export const propCount = (level: number) => (level <= 0 ? 400 : level === 1 ? 900 : 1600);

export type Prop = { d: [number, number, number]; scale: number; turn: number; kind: PropKind };
const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** n props for a world, off the poles (|lat| < 70°), at least ~6° from any landmark building at every quality level (same seed and town sizes as Landmarks). */
export function scatter(world: string, seed: number, n: number): Prop[] {
  const kinds = PROPS[world];
  if (!kinds) return [];
  const town = [towns(seed, 3, 4), towns(seed, 5, 6), towns(seed, 7, 7)].flat().map((b) => b.d), clear = Math.cos((6 * Math.PI) / 180), maxY = Math.sin((70 * Math.PI) / 180);
  const r = rng(Math.max(1, Math.floor(seed * 104729) % 2147483646)), out: Prop[] = [];
  for (let tries = 0; out.length < n && tries < n * 4; tries++) {
    const y = (r() * 2 - 1) * maxY, a = r() * Math.PI * 2, rr = Math.sqrt(1 - y * y); // uniform on the band
    const d: [number, number, number] = [rr * Math.cos(a), y, rr * Math.sin(a)];
    if (town.some((t) => t[0] * d[0] + t[1] * d[1] + t[2] * d[2] > clear)) continue;
    let pick = r(), kind = kinds[0][0];
    for (const [k, w] of kinds) { if (pick < w) { kind = k; break; } pick -= w; }
    out.push({ d, scale: 0.5 + r() * r() * 1.0, turn: r() * Math.PI * 2, kind });
  }
  return out;
}
