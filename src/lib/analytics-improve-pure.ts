// ANALYTICS improvement loop (ANA02 time saved, ANA07 experiments, ANA08 weekly improvement queue). Pure; tested in
// tests/analytics-improve.test.ts. Built on analytics-outcomes-pure (same units and denominators). Store: analytics-store.ts.
import { outcomeRates, pct, reliability, worstFailure, type MetricId, type Unit, type WorkflowType } from "./analytics-outcomes-pure.ts";

const TYPES: WorkflowType[] = ["single", "chain", "goal", "mission"];

/* ---------- ANA02: time saved, as an owner-calibrated estimate ---------- */

/** His own numbers: minutes a task of each type would take him by hand, and minutes each touch (approval, rejection, retry) costs him. */
export type Calibration = { manual: Partial<Record<WorkflowType, number>>; touch: number | null; at?: string };
export function cleanCalibration(x: unknown): Calibration {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>, m = (o.manual ?? {}) as Record<string, unknown>;
  const min = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 24 * 60 ? Math.round(v) : undefined);
  return { manual: Object.fromEntries(TYPES.map((t) => [t, min(m[t])]).filter(([, v]) => v !== undefined)), touch: min(o.touch) ?? null };
}
/** Accepted units × his manual minutes, minus supervision (every approval, rejection and retry × his minutes per touch) over ALL
 *  finished units, including the failed ones that saved nothing. Unknown (null) until he has calibrated; types without his number
 *  are listed, never guessed. It's an estimate from his numbers, not a measurement. */
export function timeSaved(us: Unit[], cal: Calibration) {
  if (cal.touch === null || !Object.keys(cal.manual).length) return null;
  const rows = TYPES.map((type) => {
    const list = us.filter((u) => u.type === type), o = outcomeRates(list), m = cal.manual[type];
    const fin = list.filter((u) => o.accepted.all.includes(u.id));
    const touches = fin.reduce((s, u) => s + (u.attempts.length - 1) + u.attempts.reduce((a, t) => a + (Array.isArray(t.pending) ? t.pending.filter((p) => p?.status === "approved" || p?.status === "rejected").length : 0), 0), 0);
    return { type, accepted: o.accepted.n, finished: o.finished, manual: m ?? null, touches, gross: m === undefined ? null : o.accepted.n * m, supervision: touches * cal.touch! };
  }).filter((r) => r.finished);
  const known = rows.filter((r) => r.gross !== null);
  return {
    rows, minutes: known.reduce((s, r) => s + r.gross! - r.supervision, 0) - rows.filter((r) => r.gross === null).reduce((s, r) => s + r.supervision, 0),
    uncalibrated: rows.filter((r) => r.gross === null && r.accepted).map((r) => r.type), label: "estimate" as const,
  };
}

/* ---------- ANA07: experiments ---------- */

export const EXP_METRICS = ["accepted", "autonomous", "intervention", "rework", "success"] as const satisfies readonly MetricId[];
export type ExpMetric = (typeof EXP_METRICS)[number];
export type Experiment = { id: string; name: string; change: string; metric: ExpMetric; start: string; end: string | null; decision?: "keep" | "revert" | "inconclusive"; decidedAt?: string };
export const MIN_EXP = 10;
export function cleanExperiment(x: unknown, id: string, now: string): Experiment | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const name = s(o.name, 80), change = s(o.change, 300), metric = o.metric as ExpMetric;
  if (!name || change.length < 5) return "Name the experiment and the one change it tests";
  if (!EXP_METRICS.includes(metric)) return "Pick a metric";
  return { id, name, change, metric, start: now, end: null };
}
const rateOf = (us: Unit[], m: ExpMetric) => (m === "success" ? reliability(us).reduce((a, r) => ({ n: a.n + r.success.n, of: a.of + r.success.of }), { n: 0, of: 0 }) : outcomeRates(us)[m]);
/** Before/after on the chosen metric: the same-length window before the start vs since the start. Not a controlled test:
 *  anything else that changed in that time is mixed in. "too few" until both sides have MIN_EXP finished units. */
export function experimentResult(e: Experiment, us: Unit[], now: number) {
  const s = Date.parse(e.start), end = e.end ? Date.parse(e.end) : now, len = end - s;
  const at = (u: Unit) => Date.parse(u.attempts[0].created_at);
  const before = rateOf(us.filter((u) => at(u) >= s - len && at(u) < s), e.metric), after = rateOf(us.filter((u) => at(u) >= s && at(u) <= end), e.metric);
  const p = (r: { n: number; of: number }) => (r.of ? Math.round((100 * r.n) / r.of) : null);
  const enough = before.of >= MIN_EXP && after.of >= MIN_EXP;
  return { before: { n: before.n, of: before.of, pct: p(before) }, after: { n: after.n, of: after.of, pct: p(after) }, days: Math.max(1, Math.round(len / 86_400_000)),
    diff: enough ? p(after)! - p(before)! : null, enough };
}

/* ---------- ANA08: weekly improvement queue ---------- */

export type Improvement = { key: string; title: string; objective: string; acceptance: string; evidence: string[]; units: number };
const RATE_ISSUES = [["timeout", "time out"], ["stale", "fail on stale input"], ["duplicate", "are blocked as duplicates"], ["verifyFail", "lack read-back verification"]] as const;
/** Up to 3 problems seen in the data, biggest first, each a scoped OPERATIONS task: investigate and propose a fix with evidence.
 *  Rates need 5+ finished units and 20%+; the key is per ISO week so the same problem is queued at most once a week. */
export function improvementQueue(us: Unit[], week: string): Improvement[] {
  const out: Improvement[] = [];
  const w = worstFailure(us);
  if (w) out.push({ key: `${week}:fail:${w.error.slice(0, 60)}`, title: `Fix recurring failure: ${w.error.slice(0, 80)}`, objective: `Find why "${w.error.slice(0, 120)}" keeps failing and propose a fix`,
    acceptance: "Root cause named with the failing task ids; a proposed change with a test; nothing changed without approval", evidence: w.ids.slice(0, 20), units: w.ids.length });
  for (const r of reliability(us)) for (const [k, what] of RATE_ISSUES) {
    const rate = r[k], p = pct(rate);
    if (rate.of >= 5 && p !== null && p >= 20) out.push({ key: `${week}:${r.type}:${k}`, title: `${p}% of ${r.type} tasks ${what}`, objective: `Reduce how often ${r.type} tasks ${what} (${rate.n} of ${rate.of})`,
      acceptance: `A proposed change with the expected effect on this rate, measured as an ANALYTICS experiment; nothing changed without approval`, evidence: rate.ids.slice(0, 20), units: rate.n });
  }
  const rw = outcomeRates(us).rework, rp = pct(rw);
  if (rw.of >= 5 && rp !== null && rp >= 20) out.push({ key: `${week}:rework`, title: `${rp}% of finished work needed rework`, objective: `Find what makes done work need another attempt (${rw.n} of ${rw.of})`,
    acceptance: "The common cause across the listed tasks, and one proposed change; nothing changed without approval", evidence: rw.ids.slice(0, 20), units: rw.n });
  return out.sort((a, b) => b.units - a.units).slice(0, 3);
}
/** ISO week key, e.g. 2026-W44. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}
export const proposalFor = (i: Improvement) => ({
  title: i.title.slice(0, 200), agent: "vector", kind: "improvement",
  why: `Weekly improvement queue (${i.key.split(":")[0]}): ${i.units} task(s) affected.`.slice(0, 1000),
  prompt: `Objective: ${i.objective}\nAcceptance: ${i.acceptance}\nScope: read-only investigation of these tasks; propose, don't apply.\nEvidence task ids: ${i.evidence.join(", ")}`.slice(0, 8000),
});
