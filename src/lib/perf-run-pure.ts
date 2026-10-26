// Scripted perf run (roadmap 1.2): the fixed script PerfRun.tsx plays, per-segment stats, the trust-boundary check for
// a posted run, and run-vs-previous comparison (scripts/perf-run.ts, ANALYTICS PERF card, the health snapshot).
// Timings, sizes and the GPU name only.
import { frameStats, type FrameRing, type FrameStats } from "./perf-pure.ts";

export type Step = { seg: string; ms: number; nav?: string | null }; // nav: a panel id, or null = back to the galaxy
const WORLDS = ["studio", "intelligence", "memory", "arch", "agents"];
/** Boot frames (until galaxy-drawn) are "boot"; frames while perfCtx.dive is set go to "dive" whatever the step. */
export const PERF_RUN_SCRIPT: Step[] = [
  { seg: "intro", ms: 3000 }, // the galaxy's intro flight (INTRO_SECS 2.4) after the first draw
  { seg: "galaxy-idle", ms: 10_000 },
  ...WORLDS.flatMap((w): Step[] => [{ seg: w, ms: 6000, nav: w }, { seg: "return", ms: 3000, nav: null }]),
  { seg: "galaxy-idle-end", ms: 10_000 },
];

export type RunSegment = FrameStats & { seg: string; worst: number; jank: number; long: number; level: number; rdpr: number; cw: number; ch: number; dpr: number };
export type RunMark = { mark: string; at: number; seg?: string; extra?: Record<string, unknown> };
export type PerfRun = { at: number; label: string; w: number; h: number; dpr: number; gpu: string; hidden: boolean; segments: RunSegment[]; marks: RunMark[] };

const JANK_MS = 50, LONG_MS = 150;
/** Stats of one segment's ring plus its worst frame and frames over 50 / 150 ms. `scratch` is left sorted by frameStats. */
export function runSegment(r: FrameRing, scratch: Float32Array): (FrameStats & { worst: number; jank: number; long: number }) | null {
  const s = frameStats(r, scratch);
  if (!s) return null;
  const sorted = scratch.subarray(0, r.n);
  let jank = 0, long = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i] > JANK_MS; i--) { jank++; if (sorted[i] > LONG_MS) long++; }
  return { ...s, worst: Math.round(sorted[sorted.length - 1] * 10) / 10, jank, long };
}

const num = (x: unknown, lo = -1, hi = 1e7) => typeof x === "number" && Number.isFinite(x) && x >= lo && x < hi;
const NAME = /^[\w:-]{1,40}$/;
const SEG_NUMS = ["n", "p50", "p95", "p99", "fps", "worst", "jank", "long", "level", "rdpr", "cw", "ch", "dpr"] as const;

/** Validates a posted run (trust boundary: the body is the browser's). `at` is set by the server. */
export function cleanRun(x: unknown, at: number): PerfRun | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.label !== "string" || !NAME.test(o.label) || !num(o.w, 1) || !num(o.h, 1) || !num(o.dpr, 0.1, 10) || !Array.isArray(o.segments)) return null;
  const segments: RunSegment[] = [];
  for (const s of o.segments.slice(0, 30) as Record<string, unknown>[]) {
    if (!s || typeof s.seg !== "string" || !NAME.test(s.seg) || !SEG_NUMS.every((k) => num(s[k]))) return null;
    segments.push(Object.fromEntries([["seg", s.seg], ...SEG_NUMS.map((k) => [k, s[k]])]) as RunSegment);
  }
  if (!segments.length) return null;
  const marks: RunMark[] = [];
  for (const m of (Array.isArray(o.marks) ? o.marks.slice(0, 40) : []) as Record<string, unknown>[]) {
    if (!m || typeof m.mark !== "string" || !NAME.test(m.mark) || !num(m.at, 0)) continue;
    const extra = m.extra && typeof m.extra === "object" && JSON.stringify(m.extra).length < 2000 ? (m.extra as Record<string, unknown>) : undefined;
    marks.push({ mark: m.mark, at: m.at as number, ...(typeof m.seg === "string" && NAME.test(m.seg) ? { seg: m.seg } : {}), ...(extra ? { extra } : {}) });
  }
  return { at, label: o.label, w: o.w as number, h: o.h as number, dpr: o.dpr as number, gpu: typeof o.gpu === "string" ? o.gpu.slice(0, 160) : "unknown", hidden: o.hidden === true, segments, marks };
}

/** The newest earlier run at the same label (window size), or null. */
export const previousOf = (runs: PerfRun[], cur: PerfRun) =>
  runs.filter((r) => r.label === cur.label && r.at < cur.at).sort((a, b) => b.at - a.at)[0] ?? null;

export type CompareRow = { seg: string; fps: number; p95: number; p99: number; long: number; prevP95: number | null; pct: number | null; regressed: boolean };
/** p95 regression: more than `threshold` (15%) slower than the previous run, and at least 1 ms (vsync jitter is not a regression). */
export function compareRuns(prev: PerfRun | null, cur: PerfRun, threshold = 0.15): CompareRow[] {
  return cur.segments.map((s) => {
    const p = prev?.segments.find((x) => x.seg === s.seg);
    const pct = p && p.p95 > 0 ? Math.round(((s.p95 - p.p95) / p.p95) * 1000) / 10 : null;
    return { seg: s.seg, fps: s.fps, p95: s.p95, p99: s.p99, long: s.long, prevP95: p ? p.p95 : null, pct, regressed: !!p && s.p95 > p.p95 * (1 + threshold) && s.p95 - p.p95 >= 1 };
  });
}

/** Plain-text table for the terminal. */
export function formatRun(cur: PerfRun, rows: CompareRow[]): string {
  const pad = (v: unknown, n: number) => String(v).padStart(n);
  const head = `${cur.label}  (page ${cur.w}x${cur.h} @${cur.dpr}x)  ${cur.gpu}${cur.hidden ? "  (window was hidden: numbers are not valid)" : ""}`;
  const lines = [head, `${"segment".padEnd(16)}${pad("fps", 7)}${pad("p95", 7)}${pad("p99", 7)}${pad("long", 6)}${pad("prev95", 8)}${pad("chg%", 8)}`];
  for (const r of rows) lines.push(`${r.seg.padEnd(16)}${pad(r.fps, 7)}${pad(r.p95, 7)}${pad(r.p99, 7)}${pad(r.long, 6)}${pad(r.prevP95 ?? "-", 8)}${pad(r.pct === null ? "-" : (r.pct > 0 ? "+" : "") + r.pct, 8)}${r.regressed ? "  REGRESSION" : ""}`);
  return lines.join("\n");
}

/** One line per regressed segment, for the health collector and the ANALYTICS card. */
export const regressionLines = (cur: PerfRun, rows: CompareRow[]) =>
  rows.filter((r) => r.regressed).map((r) => `Perf run ${cur.label}: ${r.seg} p95 ${r.prevP95} ms -> ${r.p95} ms (+${r.pct}%)`);
