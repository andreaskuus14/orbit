// Planet worlds v3: layouts for GAME DEV (a floating game island), ARCH (dimension tags), MEMORY (a crystal city round a spire)
// and LIFE (a garden island). Pure and deterministic (no Math.random): the scene doesn't jump on re-render. Tests: tests/worlds-v3.test.ts.
// LIFE uses habit positions only; nothing from the journal is ever read here.

export type V3 = [number, number, number];
const r2 = (n: number) => Math.round(n * 100) / 100;
const GOLDEN = 2.39996;

/** Seeded 0..1 sequence (Park-Miller). */
export function rng(seed: number) { let s = Math.max(1, Math.floor(Math.abs(seed)) % 2147483646); return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

/** n spots in a ring band [rMin, rMax], kept `gap` away from each avoid circle [x, z, r]. Fewer than n if the band is crowded. */
export function scatter(n: number, rMin: number, rMax: number, seed: number, avoid: [number, number, number][] = [], gap = 0): { x: number; z: number; s: number }[] {
  const r = rng(seed), out: { x: number; z: number; s: number }[] = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(rMin * rMin + r() * (rMax * rMax - rMin * rMin)), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar + gap)) continue;
    out.push({ x: r2(x), z: r2(z), s: r2(0.7 + r() * 0.6) });
  }
  return out;
}

/* ---------- GAME DEV: the focus game as a floating island; how much is built follows its stage ---------- */

export const DEV_STAGES = ["idea", "prototype", "alpha", "beta", "live"] as const;
type DevStage = (typeof DEV_STAGES)[number];
/** Share of the island's buildings that stand solid; the rest show as hologram wireframe still to build. */
export const STAGE_BUILT: Record<DevStage, number> = { idea: 0.1, prototype: 0.3, alpha: 0.5, beta: 0.8, live: 1 };
const SEV = ["crash", "major", "minor", "polish"] as const;
type Sev = (typeof SEV)[number];
export type DevPart = { at: V3; size: V3; kind: "tower" | "hall" | "wall"; built: boolean };
/** Castle slots on the island's back hill, biggest first (so a young game has its keep, not a stray wall). */
const SLOTS: { at: [number, number]; size: V3; kind: DevPart["kind"] }[] = [
  { at: [0.2, -1.6], size: [1.6, 2.6, 1.6], kind: "hall" }, { at: [-1.3, -1.9], size: [0.7, 3.6, 0.7], kind: "tower" },
  { at: [1.6, -2.1], size: [0.7, 3.2, 0.7], kind: "tower" }, { at: [-0.4, -2.9], size: [2.4, 1.6, 1.2], kind: "hall" },
  { at: [2.6, -0.9], size: [1.2, 1.4, 1.2], kind: "hall" }, { at: [-2.5, -1.0], size: [1.0, 1.8, 1.0], kind: "hall" },
  { at: [0.9, -3.4], size: [0.6, 4.2, 0.6], kind: "tower" }, { at: [-1.9, -3.0], size: [0.5, 2.6, 0.5], kind: "tower" },
  { at: [2.9, 0.4], size: [1.6, 0.8, 0.3], kind: "wall" }, { at: [-2.9, 0.2], size: [1.6, 0.8, 0.3], kind: "wall" },
];
type Game = { id: string; name: string; stage: string; platform?: string };
type Bug = { game: string; severity: string; status: string };
export type DevIsland = {
  focus: { id: string; name: string; stage: DevStage; built: number; open: number; crash: number; bySev: Record<Sev, number> } | null;
  parts: DevPart[]; bugs: { sev: Sev; r: number; phase: number; speed: number; tilt: number; y: number }[]; drones: number;
  portalLit: boolean; others: { id: string; name: string; stage: DevStage; open: number; at: V3; size: number }[];
};
const stageOf = (s: string): DevStage => ((DEV_STAGES as readonly string[]).includes(s) ? (s as DevStage) : "idea");
const active = (b: Bug) => b.status === "open" || b.status === "fixing";

/** The world's games and bugs → the island scene. focus: the picked game, else the furthest along (ties: most open bugs).
 *  running: game tasks running or queued now (one drone each, at most 6). */
export function devIsland(world: { games?: Game[]; bugs?: Bug[] } | null, opts: { selected?: string | null; running?: number } = {}): DevIsland {
  const games = Array.isArray(world?.games) ? world!.games.filter((g) => g && typeof g.id === "string") : [];
  const bugs = Array.isArray(world?.bugs) ? world!.bugs.filter((b) => b && active(b)) : [];
  const open = (id: string) => bugs.filter((b) => b.game === id).length;
  const ranked = [...games].sort((a, b) => DEV_STAGES.indexOf(stageOf(b.stage)) - DEV_STAGES.indexOf(stageOf(a.stage)) || open(b.id) - open(a.id));
  const f = games.find((g) => g.id === opts.selected) ?? ranked[0];
  const drones = Math.max(0, Math.min(6, Math.floor(opts.running ?? 0)));
  if (!f) return { focus: null, parts: [], bugs: [], drones, portalLit: false, others: [] };
  const stage = stageOf(f.stage), nBuilt = Math.max(1, Math.round(STAGE_BUILT[stage] * SLOTS.length));
  const parts = SLOTS.map((s, i): DevPart => ({ at: [s.at[0], s.size[1] / 2, s.at[1]], size: s.size, kind: s.kind, built: i < nBuilt }));
  const mine = bugs.filter((b) => b.game === f.id);
  const bySev = Object.fromEntries(SEV.map((s) => [s, mine.filter((b) => b.severity === s).length])) as Record<Sev, number>;
  const swarm = mine.slice(0, 120).map((b, k) => { const h = (k * 0.618034) % 1, sev = (SEV as readonly string[]).includes(b.severity) ? (b.severity as Sev) : "minor";
    return { sev, r: r2(5.4 + h * 1.6), phase: r2(k * 2.1), speed: r2(0.25 + h * 0.3), tilt: r2((h - 0.5) * 0.8), y: r2(1 + h * 2.5) }; });
  const rest = ranked.filter((g) => g.id !== f.id).slice(0, 6);
  const others = rest.map((g, i) => { const a = -0.25 - i * 0.55, d = 9.5 + (i % 2) * 2.5, st = stageOf(g.stage);
    return { id: g.id, name: g.name || "Game", stage: st, open: open(g.id), at: [r2(Math.cos(a) * d), r2(2.5 + (i % 3) * 1.2), r2(Math.sin(a) * d)] as V3, size: r2(0.8 + DEV_STAGES.indexOf(st) * 0.2) }; });
  return { focus: { id: f.id, name: f.name || "Game", stage, built: nBuilt, open: mine.length, crash: bySev.crash, bySev }, parts, bugs: swarm, drones,
    portalLit: stage === "beta" || stage === "live", others };
}

/* ---------- ARCH: the footprint and height of the house, for the dimension tags ---------- */

type APart = { kind: string; x: number; y: number; z: number; w: number; d: number; h: number };
/** Footprint box of the ground-floor structure (foundation, slab, walls at the lowest level). null for an empty model. */
export function archFootprint(parts: APart[]) {
  const base = parts.filter((p) => ["foundation", "slab", "wall"].includes(p.kind) && [p.x, p.z, p.w, p.d].every(Number.isFinite));
  if (!base.length) return null;
  const y0 = Math.min(...base.map((p) => p.y)), low = base.filter((p) => p.y <= y0 + 0.5);
  const x0 = Math.min(...low.map((p) => p.x - p.w / 2)), x1 = Math.max(...low.map((p) => p.x + p.w / 2));
  const z0 = Math.min(...low.map((p) => p.z - p.d / 2)), z1 = Math.max(...low.map((p) => p.z + p.d / 2));
  return { x0: r2(x0), x1: r2(x1), z0: r2(z0), z1: r2(z1), w: r2(x1 - x0), d: r2(z1 - z0) };
}
/** "7.65 m" (two decimals under 10 m, one above). */
export const metres = (m: number) => `${m < 10 ? m.toFixed(2) : m.toFixed(1)} m`;

/* ---------- MEMORY: clusters become districts of one crystal city, threads to the spire and to near neighbours ---------- */

export type CityIn = { kind: string; count: number; x: number; z: number };
export function memoryCity(clusters: CityIn[], ground: number) {
  const total = clusters.reduce((s, c) => s + c.count, 0);
  const cx = clusters.length ? clusters.reduce((s, c) => s + c.x * c.count, 0) / Math.max(1, total) : 0;
  const cz = clusters.length ? clusters.reduce((s, c) => s + c.z * c.count, 0) / Math.max(1, total) : 0;
  const spire = { x: r2(cx), z: r2(cz), h: r2(4 + Math.min(6, Math.log10(1 + total) * 2.4)) };
  const plateaus = clusters.map((c) => ({ x: c.x, z: c.z, r: r2(1.4 + Math.min(2.6, Math.sqrt(c.count) * 0.22)) }));
  const key = new Set<string>(), threads: [V3, V3][] = [];
  const y = r2(ground + 0.25);
  clusters.forEach((c, i) => {
    threads.push([[c.x, y, c.z], [spire.x, y, spire.z]]);
    clusters.map((o, j) => ({ j, d: Math.hypot(o.x - c.x, o.z - c.z) })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2).forEach(({ j }) => {
      const k = i < j ? `${i}-${j}` : `${j}-${i}`; if (key.has(k)) return; key.add(k);
      threads.push([[c.x, y, c.z], [clusters[j].x, y, clusters[j].z]]);
    });
  });
  // the spire: one tall crystal and a crown of smaller ones round it, sized by how much is remembered
  const crown = Array.from({ length: 14 }, (_, i) => { const a = i * GOLDEN, rr = 0.7 + (i % 3) * 0.45;
    return { at: [r2(spire.x + Math.cos(a) * rr), ground, r2(spire.z + Math.sin(a) * rr)] as V3, h: r2(spire.h * (0.25 + ((i * 7) % 5) * 0.08)) }; });
  return { spire, plateaus, threads, crown, total };
}

/* ---------- LIFE: plants, stepping stones and lily pads round the habit pods (habits only, never the journal) ---------- */

export function lifeGarden(pods: { at: V3 }[]) {
  const avoid: [number, number, number][] = [[0, 0, 2.5], ...pods.map((p) => [p.at[0], p.at[2], 1.25] as [number, number, number])];
  const stones = Array.from({ length: 26 }, (_, i) => { const a = (i / 26) * Math.PI * 2; return { x: r2(Math.cos(a) * 3.05), z: r2(Math.sin(a) * 3.05), s: r2(0.85 + ((i * 5) % 3) * 0.12) }; });
  const bushes = scatter(34, 2.8, 7.1, 11, avoid, 0.15);
  const flowers = scatter(70, 2.6, 7.3, 29, avoid, 0.05);
  const pads = scatter(7, 0.5, 1.9, 5);
  const tree = { x: 5.4, z: -3.6 }; // the blossom tree, back right like the frame; pods sit on r 4.2 so it stays clear of them
  return { stones, bushes: bushes.filter((b) => Math.hypot(b.x - tree.x, b.z - tree.z) > 1.4), flowers, pads, tree };
}
