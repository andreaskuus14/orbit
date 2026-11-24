// ANALYTICS summary, pure; tested in tests/analytics-summary.test.ts. The server (lib/analytics-summary.ts) reads the rows and
// this file totals them, so the browser gets one small reply instead of thousands of task and usage rows.
// Same rules as analytics-outcomes-pure: no denominator → unknown (null), never 0; every rate keeps a few of its records.
import { outcomeRates, pct, reliability, timeAndCost, units, worstFailure, type Rate, type TaskRow, type UsageCostRow, type Unit, type WorkflowType } from "./analytics-outcomes-pure.ts";
import { experimentResult, improvementQueue, isoWeek, timeSaved, type Calibration, type Experiment, type Improvement } from "./analytics-improve-pure.ts";
import { summarizeRuns, type ModelRuns } from "./model-log-pure.ts";
import type { EventRow } from "./ledger-pure.ts";

export type Days = 7 | 30;
export const parseDays = (v: unknown): Days => (String(v) === "30" ? 30 : 7);
export const TZ = "Europe/Tallinn";

/* ---------- readable usage labels ---------- */

export const AREAS = ["core", "agents", "studio", "research", "briefing", "goals", "business", "memory", "life", "upkeep", "other"] as const;
export type Area = (typeof AREAS)[number];
const AREA_OF: Record<string, Area> = {
  core: "core", call: "core", twin: "core", translate: "core", proactive: "core", hive: "core", job: "agents",
  agent: "agents", outcome: "agents", pilot: "agents", personas: "agents", skills: "agents",
  clips: "studio", "yt-autopilot": "studio", studio: "studio", "vault-podcast": "studio", longform: "studio", devworld: "studio", devsession: "studio",
  research: "research", ideas: "research", study: "research", scout: "research", chronicle: "research",
  pulse: "briefing", news: "briefing", intel: "briefing", night: "briefing",
  goals: "goals", portfolio: "business", business: "business", deals: "business", site: "business",
  memo: "memory", memory: "memory", people: "memory", sleep: "life", health: "life", life: "life",
  "self-improve": "upkeep", "self-improve-patch": "upkeep", "night-repair": "upkeep", selfcheck: "upkeep", scorecard: "upkeep", login: "upkeep",
};
/** "agent.nova.review" → agents / Nova; "clips.dub" → studio. Unknown purposes are "other", never shown raw. */
export function purposeArea(purpose: string | null | undefined): { area: Area; agent?: string } {
  const parts = String(purpose ?? "").trim().toLowerCase().split(".");
  const area = AREA_OF[parts[0]] ?? "other";
  if (parts[0] === "agent" && parts[1] && /^[a-z0-9-]{1,40}$/.test(parts[1])) return { area, agent: parts[1].split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") };
  return { area };
}
/** "claude-opus-4-1-20250805" → "Claude Opus 4.1"; "qwen2.5:7b" → "Qwen 2.5 (local)". Product names, not translated. */
export function modelName(model: string | null | undefined): string {
  const m = String(model ?? "").trim().toLowerCase();
  if (!m) return "Unknown model";
  const c = m.match(/^claude-(?:(\d+)(?:-(\d))?-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d{1,2}))?)?/);
  if (c) {
    const fam = c[3][0].toUpperCase() + c[3].slice(1);
    const major = c[1] ?? c[4], minor = c[1] ? c[2] : c[5];
    return `Claude ${fam}${major ? ` ${major}${minor ? `.${minor}` : ""}` : ""}`;
  }
  const local = m.match(/^(?:ollama[:/])?(qwen|llama|gemma|mistral|phi|deepseek)[-_]?([\d.]*)/);
  if (local) return `${local[1][0].toUpperCase() + local[1].slice(1)}${local[2] ? ` ${local[2].replace(/\.$/, "")}` : ""} (local)`;
  return "Other model";
}

export type UsageGroup = { area: Area; agent?: string; model: string; calls: number; tokens: number; usd: number };
/** Usage rows merged by area (+ agent) and readable model name, most tokens first. */
export function usageGroups(rows: UsageCostRow[]): UsageGroup[] {
  const g = new Map<string, UsageGroup>();
  for (const r of rows) {
    const a = purposeArea(r.purpose), model = modelName(r.model), k = `${a.area}|${a.agent ?? ""}|${model}`;
    const x = g.get(k) ?? { ...a, model, calls: 0, tokens: 0, usd: 0 };
    x.calls++; x.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0); x.usd += Number(r.cost_usd) > 0 ? Number(r.cost_usd) : 0;
    g.set(k, x);
  }
  return [...g.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls);
}

/* ---------- the timeline ---------- */

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const dayKey = (ms: number) => dayFmt.format(new Date(ms));
export type DayPoint = { date: string; done: number; failed: number; tokens: number };
/** One point per Tallinn day in the window, oldest first: finished tasks (top-level, done/failed by finish day) and AI tokens. */
export function dailySeries(tasks: TaskRow[], usage: (UsageCostRow & { created_at?: string })[] | null, days: Days, now: number): DayPoint[] {
  const pts = new Map<string, DayPoint>();
  for (let i = days - 1; i >= 0; i--) { const d = dayKey(now - i * 86_400_000); pts.set(d, { date: d, done: 0, failed: 0, tokens: 0 }); }
  for (const t of tasks) {
    if (t.parent_id || (t.status !== "done" && t.status !== "failed")) continue;
    const at = Date.parse(t.finished_at ?? t.created_at), p = Number.isFinite(at) ? pts.get(dayKey(at)) : undefined;
    if (p) p[t.status === "done" ? "done" : "failed"]++;
  }
  for (const u of usage ?? []) {
    const at = Date.parse(u.created_at ?? ""), p = Number.isFinite(at) ? pts.get(dayKey(at)) : undefined;
    if (p) p.tokens += (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
  }
  return [...pts.values()];
}

/* ---------- the whole reply ---------- */

export type Item = { id: string; title: string; status: string };
export type RateOut = { n: number; of: number; pct: number | null; items: Item[] };
const CAP = 20;
function rateOut(r: Rate, by: Map<string, TaskRow>, cap = CAP): RateOut {
  const ids = (r.ids.length ? r.ids : r.all).slice(0, cap);
  return { n: r.n, of: r.of, pct: pct(r), items: ids.map((id) => ({ id, title: by.get(id)?.title ?? "", status: by.get(id)?.status ?? "" })) };
}

export type SummaryIn = {
  days: Days; now: number;
  tasks: TaskRow[]; tasksCapped: boolean; chains: Set<string>;
  usage: (UsageCostRow & { created_at?: string })[] | null;
  projects: Map<string, string>;
  calibration: Calibration; experiments: Experiment[]; queued: Record<string, string>;
  events: { id?: string | number; type: string; created_at: string }[];
  modelRunRows: EventRow[] | null;
  counts: { memories: number | null; messages: number | null };
};

export function buildSummary(x: SummaryIn) {
  const us: Unit[] = units(x.tasks, x.chains), by = new Map(x.tasks.map((t) => [t.id, t]));
  const o = outcomeRates(us), rel = reliability(us), worst = worstFailure(us), tc = timeAndCost(us, x.usage), ts = timeSaved(us, x.calibration);
  const week = isoWeek(new Date(x.now));
  const runs: ModelRuns | null = x.modelRunRows ? summarizeRuns(x.modelRunRows, x.now, x.days) : null;
  return {
    days: x.days, at: new Date(x.now).toISOString(), capped: x.tasksCapped,
    counts: x.counts,
    outcomes: {
      finished: o.finished, open: o.open,
      accepted: rateOut(o.accepted, by), autonomous: rateOut(o.autonomous, by), intervention: rateOut(o.intervention, by), rework: rateOut(o.rework, by),
    },
    reliability: rel.map((r) => ({
      type: r.type as WorkflowType, sample: r.sample,
      success: rateOut(r.success, by, 0), recovery: rateOut(r.recovery, by, 0), timeout: rateOut(r.timeout, by, 0),
      stale: rateOut(r.stale, by, 0), duplicate: rateOut(r.duplicate, by, 0), verifyFail: rateOut(r.verifyFail, by, 0),
    })),
    worst: worst ? { error: worst.error, items: worst.ids.slice(0, CAP).map((id) => ({ id, title: by.get(id)?.title ?? "", status: by.get(id)?.status ?? "" })) } : null,
    saved: ts ? { minutes: ts.minutes, uncalibrated: ts.uncalibrated, rows: ts.rows } : null,
    calibration: x.calibration,
    cost: {
      metered: tc.metered, subscription: tc.subscription, gaps: tc.gaps,
      projects: tc.projects.map((p) => ({ name: p.project ? x.projects.get(p.project) ?? null : null, minutes: p.minutes, untimed: p.untimed.length, accepted: p.accepted.length, units: p.units.length }))
        .sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1)),
    },
    usage: x.usage ? usageGroups(x.usage) : null,
    daily: dailySeries(x.tasks, x.usage, x.days, x.now),
    week,
    queue: improvementQueue(us, week).map((i: Improvement) => ({ ...i, sentAt: x.queued[i.key] ?? null })),
    experiments: x.experiments.map((e) => { const r = experimentResult(e, us, x.now); return { ...e, result: { before: r.before, after: r.after, days: r.days, enough: r.enough, diff: r.diff, verdict: r.test.verdict, more: r.test.more } }; }),
    models: runs ? { total: runs.total, perModel: runs.perModel.map((m) => ({ name: modelName(m.model), runs: m.runs })), below: runs.below,
      risky: runs.risky.slice(0, CAP).map((r) => ({ at: r.at, kind: r.kind, job: r.job, model: modelName(r.model), below: r.below })) } : null,
    events: x.events.slice(0, 8).map((e, i) => ({ id: String(e.id ?? `${e.created_at}-${i}`), type: e.type, at: e.created_at })),
  };
}
export type Summary = ReturnType<typeof buildSummary>;
