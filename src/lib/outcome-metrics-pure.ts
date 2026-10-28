// Outcome metrics (roadmap 48 · 04), pure; tested in tests/outcome-metrics.test.ts. Read from existing task rows only (the tasks table).
// A unit of work = a top-level task (parent_id null). Multi-step = a team chain ("Team…" title), a goal step, or a task with child tasks;
// everything else is simple. Generated text, model calls and agent steps never count as success: only end states and the owner's choices do.
import { isoWeek } from "./health-pure.ts";

export type OutcomeTask = {
  id: string; parent_id: string | null; agent: string; title: string; status: string;
  pending?: { tool: string; status: string }[] | null; created_at: string; finished_at: string | null;
};
/** Each rate is n / of; of = its denominator (0 → no data, shown as "–"). medianMin: created → done, done units only. */
export type Rate = { n: number; of: number };
export type Outcomes = {
  units: number;
  correctionFree: Rate; // done and not redone (same agent + title again within 24 h) / finished (done, failed, cancelled)
  medianMin: number | null; // time to useful result: minutes from created to done, median over done units
  abandoned: Rate; // failed + cancelled + still open after 7 days / units
  duplicates: Rate; // same agent + title started within 10 min of an earlier one / units
  kept: Rate; // done units whose owner-reviewed actions were all approved / done units that had any approved or rejected action
};
export type WeekOutcomes = { week: string; simple: Outcomes; multi: Outcomes };

const MIN = 60_000, DUP_MS = 10 * MIN, REDO_MS = 24 * 60 * MIN, STALE_MS = 7 * 24 * 60 * MIN;
const key = (t: OutcomeTask) => `${t.agent}|${t.title.trim().toLowerCase()}`;
const ms = (s: string | null) => (s ? Date.parse(s) : NaN);
const r = (n: number, of: number): Rate => ({ n, of });

export function isMultiStep(t: OutcomeTask, hasChildren: boolean) { return hasChildren || t.title.startsWith("Team") || t.title.startsWith("Goal step "); }

function outcomes(units: OutcomeTask[], all: OutcomeTask[], now: number): Outcomes {
  const later = (t: OutcomeTask, within: number, from: number) => all.some((o) => o.id !== t.id && key(o) === key(t) && ms(o.created_at) > from && ms(o.created_at) - from <= within);
  const earlier = (t: OutcomeTask) => all.some((o) => o.id !== t.id && key(o) === key(t) && ms(o.created_at) < ms(t.created_at) && ms(t.created_at) - ms(o.created_at) <= DUP_MS);
  const done = units.filter((t) => t.status === "done"), finished = units.filter((t) => ["done", "failed", "cancelled"].includes(t.status));
  const redone = (t: OutcomeTask) => { const f = ms(t.finished_at ?? t.created_at); return later(t, REDO_MS, f); };
  const open = (t: OutcomeTask) => !["done", "failed", "cancelled"].includes(t.status) && now - ms(t.created_at) > STALE_MS;
  const reviewed = done.filter((t) => (t.pending ?? []).some((p) => p.status === "approved" || p.status === "rejected"));
  const mins = done.map((t) => (ms(t.finished_at) - ms(t.created_at)) / MIN).filter((x) => x >= 0).sort((a, b) => a - b);
  const mid = mins.length ? (mins.length % 2 ? mins[(mins.length - 1) / 2] : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2) : null;
  return {
    units: units.length,
    correctionFree: r(done.filter((t) => !redone(t)).length, finished.length),
    medianMin: mid == null ? null : Math.round(mid),
    abandoned: r(units.filter((t) => t.status === "failed" || t.status === "cancelled" || open(t)).length, units.length),
    duplicates: r(units.filter(earlier).length, units.length),
    kept: r(reviewed.filter((t) => !(t.pending ?? []).some((p) => p.status === "rejected")).length, reviewed.length),
  };
}

/** Tasks → this week and last week, each split simple vs multi-step. Weeks are ISO weeks of the unit's created_at. */
export function weeklyOutcomes(rows: OutcomeTask[], now: number): { now: WeekOutcomes; prev: WeekOutcomes } {
  const parents = new Set(rows.map((t) => t.parent_id).filter(Boolean));
  const units = rows.filter((t) => !t.parent_id && Number.isFinite(ms(t.created_at)));
  const week = (w: string): WeekOutcomes => {
    const u = units.filter((t) => isoWeek(ms(t.created_at)) === w);
    const multi = u.filter((t) => isMultiStep(t, parents.has(t.id)));
    return { week: w, simple: outcomes(u.filter((t) => !multi.includes(t)), units, now), multi: outcomes(multi, units, now) };
  };
  return { now: week(isoWeek(now)), prev: week(isoWeek(now - 7 * 24 * 60 * MIN)) };
}

/** Rate as a whole percent, or null with no denominator. */
export const pctOf = (x: Rate) => (x.of ? Math.round((100 * x.n) / x.of) : null);
