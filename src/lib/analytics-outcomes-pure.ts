// ANALYTICS outcomes (roadmap ANA01/03/04/05), pure; tested in tests/analytics-outcomes.test.ts.
// Reads existing rows only: tasks (top-level units + their attempts) and usage. No new tables.
// Rule: a rate with no denominator is unknown (null), never 0. Every rate carries the ids of the records behind it.

/** ANA05 metric dictionary: every headline number on the panel names its entry here. */
export type MetricDef = { name: string; formula: string; source: string; tz: "Europe/Tallinn"; cadence: string; exclusions: string };
const D = (name: string, formula: string, source: string, exclusions: string): MetricDef =>
  ({ name, formula, source, tz: "Europe/Tallinn", cadence: "on open, rolling window", exclusions });
const OPEN_EXCL = "open work (queued/running/awaiting approval); sub-tasks (counted through their parent)";
export const METRICS = {
  accepted: D("Accepted deliverables", "units whose last attempt is done and whose actions you approved, none rejected / finished units", "tasks.status, tasks.pending", OPEN_EXCL),
  autonomous: D("Verified autonomous completions", "units done on the first attempt with read-back evidence, no rejection / finished units", "tasks.status, tasks.pending[].evidence", OPEN_EXCL),
  intervention: D("Intervention rate", "units you retried, rejected, abandoned or cancelled / finished units", "tasks (attempt groups), tasks.pending", OPEN_EXCL),
  rework: D("Rework", "units with a done attempt followed by another attempt / units with a done attempt", "tasks (attempt groups)", OPEN_EXCL),
  success: D("Success", "units whose last attempt is done / finished units, per workflow type", "tasks.status", OPEN_EXCL),
  recovery: D("Recovery", "units with a failed attempt that ended done / units with a failed attempt", "tasks (attempt groups)", OPEN_EXCL),
  timeout: D("Timeout", "units with an attempt whose error mentions a timeout / finished units", "tasks.error", OPEN_EXCL),
  stale: D("Stale input", "units with an attempt failing on stale/outdated or replaced input / finished units", "tasks.error", OPEN_EXCL),
  duplicate: D("Duplicate effect", "units with an attempt blocked as a duplicate or output clash / finished units", "tasks.error", OPEN_EXCL),
  verifyFail: D("Verification failure", "done units with approved actions but no read-back, or an uncertain attempt / units with approved actions", "tasks.pending", OPEN_EXCL),
  time: D("Time", "sum of finished_at − started_at (or created_at) over attempts, per project", "tasks", "attempts without a finish time (unknown, listed as a gap)"),
  cost: D("Cost", "metered = usage rows with cost_usd > 0; subscription = rows with cost 0 (flat rate); per-project cost is unavailable: usage rows carry no task or project id", "usage", "nothing is estimated"),
} satisfies Record<string, MetricDef>;
export type MetricId = keyof typeof METRICS;

export type Act = { status: string; evidence?: unknown[] };
export type TaskRow = {
  id: string; parent_id: string | null; project_id?: string | null; agent: string; title: string; status: string;
  error?: string | null; pending?: Act[] | null; created_at: string; started_at?: string | null; finished_at?: string | null;
};
/** n / of with the records behind each; of = 0 → unknown. */
export type Rate = { n: number; of: number; ids: string[]; all: string[] };
export const pct = (r: Rate): number | null => (r.of ? Math.round((100 * r.n) / r.of) : null);

const OPEN = ["queued", "running", "awaiting_approval"];
const ms = (s?: string | null) => (s ? Date.parse(s) : NaN);
const key = (t: TaskRow) => `${t.project_id ?? ""}|${t.agent}|${t.title.trim().toLowerCase()}`;
const acts = (t: TaskRow) => (Array.isArray(t.pending) ? t.pending : []);

/** A unit = one logical task: all top-level attempts with the same project+agent+title. Ten retries count once. */
export type Unit = { id: string; type: WorkflowType; attempts: TaskRow[]; last: TaskRow; project: string | null };
export type WorkflowType = "chain" | "goal" | "mission" | "single";
export function workflowType(t: TaskRow, hasChildren: boolean, missionChains: Set<string>): WorkflowType {
  if (missionChains.has(t.id)) return "mission";
  if (t.title.startsWith("Goal step ")) return "goal";
  return hasChildren || t.title.startsWith("Team") ? "chain" : "single";
}
export function units(rows: TaskRow[], missionChains: Set<string> = new Set()): Unit[] {
  const parents = new Set(rows.map((t) => t.parent_id).filter(Boolean));
  const g = new Map<string, TaskRow[]>();
  for (const t of rows) if (!t.parent_id && Number.isFinite(ms(t.created_at))) g.set(key(t), [...(g.get(key(t)) ?? []), t]);
  return [...g.values()].map((a) => {
    a.sort((x, y) => ms(x.created_at) - ms(y.created_at));
    const last = a[a.length - 1];
    return { id: last.id, attempts: a, last, project: last.project_id ?? null, type: workflowType(last, a.some((t) => parents.has(t.id)), missionChains) };
  });
}

const rate = (pool: Unit[], hit: (u: Unit) => boolean): Rate => ({ n: pool.filter(hit).length, of: pool.length, ids: pool.filter(hit).map((u) => u.id), all: pool.map((u) => u.id) });
const finished = (us: Unit[]) => us.filter((u) => !OPEN.includes(u.last.status));
const approved = (t: TaskRow) => acts(t).filter((a) => a?.status === "approved");
const rejected = (t: TaskRow) => acts(t).some((a) => a?.status === "rejected");
const readBack = (t: TaskRow) => approved(t).some((a) => (a.evidence?.length ?? 0) > 0);

/** ANA01. Cancelled counts as finished (in every denominator) and never as accepted; unverified done is never "verified". */
export function outcomeRates(us: Unit[]) {
  const f = finished(us), doneSeen = f.filter((u) => u.attempts.some((t) => t.status === "done"));
  return {
    finished: f.length, open: us.length - f.length,
    accepted: rate(f, (u) => u.last.status === "done" && approved(u.last).length > 0 && !rejected(u.last)),
    autonomous: rate(f, (u) => u.attempts.length === 1 && u.last.status === "done" && readBack(u.last) && !rejected(u.last)),
    intervention: rate(f, (u) => u.attempts.length > 1 || u.attempts.some(rejected) || u.last.status === "cancelled"),
    rework: rate(doneSeen, (u) => u.attempts.findIndex((t) => t.status === "done") < u.attempts.length - 1),
  };
}

const RX = { timeout: /time[sd]? ?out|timeout/i, stale: /stale|outdated|out of date|replace[_ ]input|input (has )?changed/i, duplicate: /duplicate|already (exists|done|applied)|clash/i };
const errs = (u: Unit, rx: RegExp) => u.attempts.some((t) => rx.test(t.error ?? ""));

/** ANA04: per workflow type, each rate with its sample size (of). */
export function reliability(us: Unit[]) {
  const types: WorkflowType[] = ["single", "chain", "goal", "mission"];
  return types.map((type) => {
    const f = finished(us.filter((u) => u.type === type));
    const withApproved = f.filter((u) => u.attempts.some((t) => approved(t).length || acts(t).some((a) => ["attempting", "uncertain"].includes(a?.status))));
    return {
      type, sample: f.length,
      success: rate(f, (u) => u.last.status === "done"),
      recovery: rate(f.filter((u) => u.attempts.some((t) => t.status === "failed")), (u) => u.last.status === "done"),
      timeout: rate(f, (u) => errs(u, RX.timeout)),
      stale: rate(f, (u) => errs(u, RX.stale)),
      duplicate: rate(f, (u) => errs(u, RX.duplicate)),
      verifyFail: rate(withApproved, (u) => u.attempts.some((t) => acts(t).some((a) => a?.status === "uncertain")) || (u.last.status === "done" && !readBack(u.last))),
    };
  });
}

/** The failure seen in the most units (≥2), by error text with numbers/ids stripped; links to its task ids. */
export function worstFailure(us: Unit[]): { error: string; ids: string[] } | null {
  const g = new Map<string, Set<string>>();
  for (const u of us) for (const t of u.attempts) if (t.status === "failed" && t.error) {
    const k = t.error.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\d+/gi, "#").trim().slice(0, 120);
    g.set(k, (g.get(k) ?? new Set()).add(t.id));
  }
  const unitsOf = (ids: Set<string>) => new Set(us.filter((u) => u.attempts.some((t) => ids.has(t.id))).map((u) => u.id)).size;
  const best = [...g].map(([error, ids]) => ({ error, ids: [...ids], n: unitsOf(ids) })).sort((a, b) => b.n - a.n || b.ids.length - a.ids.length)[0];
  return best && best.n >= 2 ? { error: best.error, ids: best.ids } : null;
}

export type UsageCostRow = { model: string; purpose: string; input_tokens: number; output_tokens: number; cost_usd: number | string | null };
/** ANA03. Minutes are null (unknown) when no attempt in the project has both ends; missing timestamps are reported as gaps. */
export function timeAndCost(us: Unit[], usage: UsageCostRow[] | null) {
  const byProject = new Map<string | null, Unit[]>();
  for (const u of us) byProject.set(u.project, [...(byProject.get(u.project) ?? []), u]);
  const projects = [...byProject].map(([project, list]) => {
    const tries = list.flatMap((u) => u.attempts).filter((t) => !OPEN.includes(t.status));
    const timed = tries.filter((t) => ms(t.finished_at) >= ms(t.started_at ?? t.created_at));
    const minutes = timed.length ? Math.round(timed.reduce((s, t) => s + (ms(t.finished_at) - ms(t.started_at ?? t.created_at)), 0) / 60_000) : null;
    const acc = outcomeRates(list).accepted;
    return { project, minutes, untimed: tries.filter((t) => !timed.includes(t)).map((t) => t.id), accepted: acc.ids, units: list.map((u) => u.id), cost: null as number | null };
  });
  const sum = (rs: UsageCostRow[]) => ({ calls: rs.length, tokens: rs.reduce((s, r) => s + Number(r.input_tokens) + Number(r.output_tokens), 0), usd: rs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) });
  const metered = usage ? usage.filter((r) => Number(r.cost_usd) > 0) : null;
  return {
    projects,
    metered: metered ? sum(metered) : null, // null = usage unreadable → unknown
    subscription: usage ? sum(usage.filter((r) => !(Number(r.cost_usd) > 0))) : null,
    gaps: [
      "ana.gapProject", // usage rows have no task/project id, so per-project cost is unavailable
      ...(projects.some((p) => p.untimed.length) ? ["ana.gapTime"] : []),
      ...(usage ? [] : ["ana.gapUsage"]),
    ],
  };
}
