// Pure perf maths: the fps meter's frame ring and percentiles (PerfBeacon), per-scene rollups and the CORE latency
// baseline (/api/perf). Timings only, never user content.

/** Fixed-size ring of frame times in ms. push() never allocates; after reset() the samples are buf[0..n-1] until it wraps. */
export class FrameRing {
  readonly buf: Float32Array;
  n = 0;
  private i = 0;
  constructor(size: number) { this.buf = new Float32Array(size); }
  push(ms: number) {
    this.buf[this.i] = ms;
    this.i = this.i + 1 === this.buf.length ? 0 : this.i + 1;
    if (this.n < this.buf.length) this.n++;
  }
  reset() { this.n = 0; this.i = 0; }
}

export type FrameStats = { n: number; p50: number; p95: number; p99: number; fps: number };
const r1 = (x: number) => Math.round(x * 10) / 10;
/** Nearest-rank percentile of an ascending array. */
const rank = (s: ArrayLike<number>, p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];

/** Frame-time percentiles (ms) and mean fps of the ring. `scratch` (same size as the ring) is sorted in place, so no garbage. */
export function frameStats(r: FrameRing, scratch: Float32Array): FrameStats | null {
  if (!r.n) return null;
  const s = scratch.subarray(0, r.n);
  s.set(r.buf.subarray(0, r.n));
  s.sort();
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i];
  return { n: r.n, p50: r1(rank(s, 0.5)), p95: r1(rank(s, 0.95)), p99: r1(rank(s, 0.99)), fps: sum > 0 ? r1((1000 * r.n) / sum) : 0 };
}

/** Which scene the frames belong to: the dive, a full-screen world covering the galaxy, or the galaxy itself. */
export function sceneOf(ctx: { dive?: unknown; paused?: unknown; selected?: unknown }): string {
  if (ctx.dive) return "dive";
  return ctx.paused && typeof ctx.selected === "string" && ctx.selected ? ctx.selected : "galaxy";
}

export type SceneWindow = FrameStats & { scene: string; dpr: number; cw: number; level: number; vis: string; rx: number };

/** Validates one posted 10 s window (trust boundary: the body is the browser's). */
export function cleanWindow(x: unknown, rx: number): SceneWindow | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.scene !== "string" || !/^[\w:-]{1,40}$/.test(o.scene)) return null;
  const nums = ["n", "p50", "p95", "p99", "fps", "dpr", "cw", "level"] as const;
  if (!nums.every((k) => typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= -1 && (o[k] as number) < 1e6)) return null;
  const v = o as Record<(typeof nums)[number], number>;
  return { scene: o.scene, n: v.n, p50: v.p50, p95: v.p95, p99: v.p99, fps: v.fps, dpr: v.dpr, cw: v.cw, level: v.level, vis: o.vis === "hidden" ? "hidden" : "visible", rx };
}

export type SceneRollup = { windows: number; frames: number; fps: number; p50: number; p95: number; p99: number; dpr: number; cw: number; level: number };

/** Per-scene stats over the last `spanMs`: exact fps (total frames / total time), median p50/p95 across windows, worst p99, latest dpr/width/level. */
export function rollupScenes(ws: SceneWindow[], now: number, spanMs = 30 * 60_000): Record<string, SceneRollup> {
  const by = new Map<string, SceneWindow[]>();
  for (const w of ws) if (now - w.rx <= spanMs && w.n > 0 && w.fps > 0) (by.get(w.scene) ?? by.set(w.scene, []).get(w.scene)!).push(w);
  const out: Record<string, SceneRollup> = {};
  for (const [scene, list] of by) {
    const frames = list.reduce((a, w) => a + w.n, 0), time = list.reduce((a, w) => a + (w.n * 1000) / w.fps, 0);
    const med = (k: "p50" | "p95") => rank(list.map((w) => w[k]).sort((a, b) => a - b), 0.5);
    const last = list[list.length - 1];
    out[scene] = { windows: list.length, frames, fps: r1((frames * 1000) / time), p50: med("p50"), p95: med("p95"), p99: Math.max(...list.map((w) => w.p99)), dpr: last.dpr, cw: last.cw, level: last.level };
  }
  return out;
}

export type CorePath = "reflex" | "memory" | "tool";
export type CoreTurn = { path: CorePath; at: number; ms: Record<string, number> };
const NOT_TOOLS = new Set(["search_memory", "think", "fallback", "review"]);

/** reflex = the canned fast path; tool = at least one real tool call; memory = the full path answering from retrieval alone. */
export function corePath(tier: string, steps: string[]): CorePath {
  if (tier.startsWith("reflex")) return "reflex";
  return steps.some((s) => !NOT_TOOLS.has(s)) ? "tool" : "memory";
}

/** p50/p95 of every logged stage (first_token, total, memory, ...) per path. */
export function coreStats(turns: CoreTurn[]): Partial<Record<CorePath, { n: number; stages: Record<string, { p50: number; p95: number }> }>> {
  const out: ReturnType<typeof coreStats> = {};
  for (const path of ["reflex", "memory", "tool"] as const) {
    const list = turns.filter((t) => t.path === path);
    if (!list.length) continue;
    const stages: Record<string, { p50: number; p95: number }> = {};
    for (const k of new Set(list.flatMap((t) => Object.keys(t.ms)))) {
      const s = list.map((t) => t.ms[k]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      stages[k] = { p50: rank(s, 0.5), p95: rank(s, 0.95) };
    }
    out[path] = { n: list.length, stages };
  }
  return out;
}
