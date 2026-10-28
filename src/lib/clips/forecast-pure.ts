// 7-day view forecast for a Short from its early views and the channel's own past curves (pure, tested in tests/forecast.test.ts).
// Method: every past Short with a 7d snapshot gives pairs (age h, views at h) → growth to 7d. A least-squares line
// ln(v7d / v_h) = a + b·ln h over all pairs predicts the target from its latest early point; the residual spread gives an 80% range.
// Too little history for a line → median growth of the 3 nearest past Shorts (same age, similar views). No history → no forecast.
// Hints are rule-based from the learn insights (retention, length, hook): no model call.
import { MIN_SAMPLE, hookLen, hookStyle, lengthBand, median, type Bucket, type LearnRec } from "./learn-pure.ts";

const H = 3_600_000, WEEK_H = 168;
export const FIT_MIN_PAIRS = 6; // a line needs at least this many points from MIN_SAMPLE Shorts
const Z80 = 1.2816, SD_MIN = 0.1, SD_NN = 0.45; // sd floor so a perfect fit still shows a range; minimum NN spread (few neighbours)

export type Point = { h: number; views: number };
export type Fit = { a: number; b: number; sd: number; pairs: number; shorts: number };
export type Forecast = { videoId: string; title: string; publishedAt: string; ageH: number; views: number;
  p50: number; lo: number; hi: number; method: "fit" | "nn" };
export type Hint = { key: "retention" | "lengthTo" | "length" | "hookTo" | "hook" | "hookLen" | "keep"; vars: Record<string, string | number> };

/** (age h, views) points with age > 0, from the snapshots and the latest stats, sorted by age. */
export function curve(r: LearnRec): Point[] {
  const pub = Date.parse(r.publishedAt ?? "");
  if (!Number.isFinite(pub)) return [];
  const seen = new Map<number, number>();
  for (const s of [...Object.values(r.snaps), r.latest]) {
    const h = s ? (Date.parse(s.at) - pub) / H : NaN;
    if (s && h > 0) seen.set(Math.round(h * 10) / 10, s.views);
  }
  return [...seen].map(([h, views]) => ({ h, views })).sort((x, y) => x.h - y.h);
}

const growth = (v7: number, v: number) => Math.log((v7 + 1) / (v + 1));
/** Training pairs: every early point (< 7 days) of each past Short that has its 7d snapshot. */
function pairs(history: LearnRec[]) {
  return history.flatMap((r) => {
    const v7 = r.snaps["7d"]?.views;
    return v7 === undefined ? [] : curve(r).filter((p) => p.h < WEEK_H).map((p) => ({ id: r.videoId, x: Math.log(p.h), lv: Math.log(p.views + 1), y: growth(v7, p.views) }));
  });
}

/** Least-squares ln-growth vs ln-age; null below FIT_MIN_PAIRS or MIN_SAMPLE Shorts. One age only → flat line (b = 0). */
export function fitCurves(history: LearnRec[]): Fit | null {
  const ps = pairs(history), shorts = new Set(ps.map((p) => p.id)).size;
  if (ps.length < FIT_MIN_PAIRS || shorts < MIN_SAMPLE) return null;
  const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length, my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
  const sxx = ps.reduce((s, p) => s + (p.x - mx) ** 2, 0), sxy = ps.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const b = sxx > 1e-6 ? sxy / sxx : 0, a = my - b * mx;
  const ss = ps.reduce((s, p) => s + (p.y - a - b * p.x) ** 2, 0);
  return { a, b, sd: Math.max(SD_MIN, Math.sqrt(ss / Math.max(1, ps.length - 2))), pairs: ps.length, shorts };
}

/** Growth from the 3 past Shorts closest in (ln age, ln views), each using its point nearest in age (within 2×). */
function nearest(history: LearnRec[], p: Point): { mid: number; lo: number; hi: number } | null {
  const x = Math.log(p.h), lv = Math.log(p.views + 1);
  const best = new Map<string, { d: number; y: number }>();
  for (const q of pairs(history)) {
    if (Math.abs(q.x - x) > Math.LN2) continue;
    const d = Math.abs(q.x - x) + Math.abs(q.lv - lv), o = best.get(q.id);
    if (!o || d < o.d) best.set(q.id, { d, y: q.y });
  }
  const ys = [...best.values()].sort((m, n) => m.d - n.d).slice(0, 3).map((n) => n.y);
  if (!ys.length) return null;
  const mid = median(ys);
  return { mid, lo: Math.min(mid - Z80 * SD_NN, ...ys), hi: Math.max(mid + Z80 * SD_NN, ...ys) }; // ≤ 3 neighbours: never a narrower range than SD_NN
}

/** Forecast for one Short still under 7 days old; null without an early point or usable history. Views never drop: lo ≥ views now. */
export function forecastShort(r: LearnRec, history: LearnRec[], fit: Fit | null = fitCurves(history)): Forecast | null {
  const p = curve(r).filter((q) => q.h < WEEK_H).at(-1);
  if (!p || r.snaps["7d"] || !r.publishedAt) return null;
  let g: { mid: number; lo: number; hi: number } | null, method: Forecast["method"];
  if (fit) {
    const mid = fit.a + fit.b * Math.log(p.h);
    g = { mid, lo: mid - Z80 * fit.sd, hi: mid + Z80 * fit.sd }; method = "fit";
  } else { g = nearest(history, p); method = "nn"; }
  if (!g) return null;
  const at = (y: number) => Math.max(p.views, Math.round((p.views + 1) * Math.exp(y) - 1));
  return { videoId: r.videoId, title: r.title, publishedAt: r.publishedAt, ageH: Math.round(p.h), views: p.views, p50: at(g.mid), lo: at(g.lo), hi: at(g.hi), method };
}

/** Forecasts for every Short under 7 days old, newest first, from the Shorts that already reached 7 days. */
export function forecastAll(recs: LearnRec[], now: number): Forecast[] {
  const history = recs.filter((r) => r.snaps["7d"]), fit = fitCurves(history);
  return recs.filter((r) => now - Date.parse(r.publishedAt ?? "") < WEEK_H * H)
    .flatMap((r) => forecastShort(r, history, fit) ?? [])
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
}

// ---- what to change next time ----

/** One rule-based hint per Short, first match wins: weak retention, an under-performing length or hook, else keep a strong feature. */
export function hintFor(r: LearnRec, recs: LearnRec[], buckets: { over: Bucket[]; under: Bucket[] }): Hint | null {
  const pct = (x: LearnRec) => x.latest?.avgViewPct ?? x.snaps["72h"]?.avgViewPct ?? x.snaps["48h"]?.avgViewPct;
  const pcts = recs.map(pct).filter((p): p is number => typeof p === "number" && p > 0), mine = pct(r);
  if (mine !== undefined && pcts.length >= MIN_SAMPLE && mine < 0.85 * median(pcts)) return { key: "retention", vars: { pct: Math.round(mine), usual: Math.round(median(pcts)) } };
  const own = { length: lengthBand(r.durationSec), hookStyle: hookStyle(r.hook), hookLen: hookLen(r.hook) } as const;
  const hit = (bs: Bucket[], dim: keyof typeof own) => bs.find((b) => b.dim === dim && b.label === own[dim]);
  const over = (dim: keyof typeof own) => buckets.over.find((b) => b.dim === dim && b.label !== own[dim]);
  if (hit(buckets.under, "length")) { const to = over("length"); return to ? { key: "lengthTo", vars: { now: own.length, to: to.label } } : { key: "length", vars: { now: own.length } }; }
  if (hit(buckets.under, "hookStyle")) { const to = over("hookStyle"); return to ? { key: "hookTo", vars: { now: own.hookStyle, to: to.label } } : { key: "hook", vars: { now: own.hookStyle } }; }
  if (hit(buckets.under, "hookLen")) return { key: "hookLen", vars: { now: own.hookLen } };
  const good = (["length", "hookStyle", "hookLen"] as const).find((d) => hit(buckets.over, d));
  return good ? { key: "keep", vars: { dim: good, label: own[good] } } : null;
}

// ---- stored forecasts and accuracy ----
// <studio>/forecasts.json keeps the FIRST forecast per Short (made from its earliest data), so accuracy isn't flattered by late re-forecasts.

export type Stored = { at: string; ageH: number; p50: number; lo: number; hi: number };
export type ForecastState = { v: 1; items: Record<string, Stored> };
export const emptyForecasts = (): ForecastState => ({ v: 1, items: {} });
const n0 = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
export const forecastProblem = (x: unknown) => {
  const s = x as ForecastState;
  return s?.v === 1 && s.items && typeof s.items === "object" && Object.values(s.items).every((i) => typeof i?.at === "string" && n0(i.ageH) && n0(i.p50) && n0(i.lo) && n0(i.hi))
    ? "" : "not a forecast state";
};

/** Adds forecasts not stored yet; null when nothing changed (no write). */
export function remember(s: ForecastState, fs: Forecast[], now: number): ForecastState | null {
  const add = fs.filter((f) => !s.items[f.videoId]);
  if (!add.length) return null;
  const at = new Date(now).toISOString(), items = { ...s.items };
  for (const f of add) items[f.videoId] = { at, ageH: f.ageH, p50: f.p50, lo: f.lo, hi: f.hi };
  return { v: 1, items };
}

export type Accuracy = { n: number; medianErrPct: number; inRange: number };
/** Stored forecasts vs the 7d views that arrived since; null until one has. */
export function accuracy(s: ForecastState, recs: LearnRec[]): Accuracy | null {
  const done = recs.flatMap((r) => { const f = s.items[r.videoId], v = r.snaps["7d"]?.views; return f && v !== undefined ? [{ f, v }] : []; });
  if (!done.length) return null;
  return { n: done.length, medianErrPct: Math.round(median(done.map(({ f, v }) => (Math.abs(f.p50 - v) / Math.max(1, v)) * 100))),
    inRange: done.filter(({ f, v }) => v >= f.lo && v <= f.hi).length };
}
