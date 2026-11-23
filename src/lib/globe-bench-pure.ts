// Numbers for scripts/globe-bench.mjs: frame times, long tasks and slow input handlers per phase (open, idle, hover, window,
// search, country), pooled over runs. Import-free so the bench script can load it with --experimental-strip-types.

export type BenchRun = {
  frames: [number, string][];            // rAF timestamp, phase
  long: [number, number, string][];      // long task start, duration, phase
  events: [number, number, string, string, number?][]; // input event start, duration (to next paint), type, phase, handler ms
  gl: Record<string, [number, number, number]>; // "phase:call" → count, total ms, max ms
  cpu?: [number, string][];              // main-thread ms of one rAF callback, phase
};
export type PhaseStats = {
  phase: string; frames: number; fps: number; p50: number; p95: number; max: number; over50: number;
  cpuP50: number; cpuP95: number; cpuMax: number; longTasks: number; longMax: number; eventMax: number; handlerMax: number; glTop: { call: string; n: number; ms: number; max: number }[];
};

export const PHASES = ["open", "idle", "hover", "window", "search", "country"] as const;

/** Value at quantile q (0..1) of an unsorted list, nearest-rank; 0 for an empty list. */
export function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** Frame intervals per phase: the gap from each frame to the next, credited to the phase the later frame drew in. */
export function intervals(frames: [number, string][]) {
  const out = new Map<string, number[]>();
  for (let i = 1; i < frames.length; i++) {
    const [t, p] = frames[i], d = t - frames[i - 1][0];
    if (!(d > 0)) continue;
    const a = out.get(p) ?? [];
    a.push(d); out.set(p, a);
  }
  return out;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function benchStats(runs: BenchRun[]): PhaseStats[] {
  return PHASES.map((phase) => {
    const d = runs.flatMap((r) => intervals(r.frames).get(phase) ?? []);
    const long = runs.flatMap((r) => r.long.filter((l) => l[2] === phase));
    const ev = runs.flatMap((r) => r.events.filter((e) => e[3] === phase));
    const gl = new Map<string, { n: number; ms: number; max: number }>();
    for (const r of runs) for (const [k, [n, ms, max]] of Object.entries(r.gl)) {
      const [p, call] = k.split(":");
      if (p !== phase) continue;
      const g = gl.get(call) ?? { n: 0, ms: 0, max: 0 };
      g.n += n; g.ms += ms; g.max = Math.max(g.max, max); gl.set(call, g);
    }
    const cpu = runs.flatMap((r) => (r.cpu ?? []).filter((c) => c[1] === phase).map((c) => c[0]));
    const total = d.reduce((a, x) => a + x, 0), n = runs.length || 1;
    return {
      phase, frames: d.length, fps: total ? r1((d.length * 1000) / total) : 0,
      p50: r1(quantile(d, 0.5)), p95: r1(quantile(d, 0.95)), max: r1(d.length ? Math.max(...d) : 0), over50: d.filter((x) => x > 50).length,
      cpuP50: r1(quantile(cpu, 0.5)), cpuP95: r1(quantile(cpu, 0.95)), cpuMax: r1(cpu.length ? Math.max(...cpu) : 0),
      longTasks: long.length, longMax: r1(long.length ? Math.max(...long.map((l) => l[1])) : 0),
      eventMax: r1(ev.length ? Math.max(...ev.map((e) => e[1])) : 0),
      handlerMax: r1(ev.length ? Math.max(...ev.map((e) => e[4] ?? 0)) : 0), // the handler itself (React renders discrete events inside it)
      glTop: [...gl.entries()].map(([call, g]) => ({ call, n: Math.round(g.n / n), ms: r1(g.ms / n), max: r1(g.max) })).sort((a, b) => b.ms - a.ms).slice(0, 4),
    };
  });
}

export function formatBench(stats: PhaseStats[], meta: { renderer: string; size: string; runs: number; software: boolean }) {
  const head = `INTELLIGENCE globe bench · ${meta.software ? "SOFTWARE GL (SwiftShader, CPU-bound; compare runs only)" : "hardware GPU"} · ${meta.renderer} · ${meta.size} · ${meta.runs} run(s)`;
  const rows = stats.map((s) => `${s.phase.padEnd(8)} ${String(s.fps).padStart(6)} fps  p50 ${String(s.p50).padStart(6)}  p95 ${String(s.p95).padStart(6)}  max ${String(s.max).padStart(6)}  >50ms ${String(s.over50).padStart(4)}  cpu ${s.cpuP50}/${s.cpuP95}/${s.cpuMax}  long ${String(s.longTasks).padStart(3)} (max ${s.longMax})  input max ${s.eventMax} (handler ${s.handlerMax})` +
    (s.glTop.length ? `\n         gl/run: ${s.glTop.map((g) => `${g.call} ${g.n}× ${g.ms} ms (max ${g.max})`).join(", ")}` : ""));
  return [head, "phase       fps        frame ms (p50 / p95 / max)          frames over 50 ms · main-thread ms per frame (p50/p95/max) · long tasks · slowest input handler", ...rows].join("\n");
}
