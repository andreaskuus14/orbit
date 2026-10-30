// AGENTS workforce (AGT01/AGT05): what each worker can actually do right now, and the night shift's plan vs what it produced.
// Pure, client-safe; tested in tests/roster.test.ts. Data: /api/agents (tools, deps), /api/night (plan, last run). UI: AgentsStation.tsx.
import type { Dep, DepState } from "./capability-pure.ts";
import { outcomeRates, pct, reliability, type Rate, type Unit, type WorkflowType } from "./analytics-outcomes-pure.ts";
import type { NightItem, NightKind, NightRun, NightSettings, NightTask } from "./night-pure.ts";

// shortcut: agent tools today need only Claude itself; add a tool's connection here when one starts using it.
export const TOOL_DEPS: Record<string, Dep[]> = {};

export type Conn = { dep: Dep; configured: boolean | null; available: boolean | null };
export type WorkerCard = {
  slug: string; domain: string; tools: { name: string; approval: boolean }[]; conns: Conn[];
  /** Missing connections: the worker is limited before launch (remedy: capRow fix text). */
  limited: Dep[]; done: number; failed: number;
};
type AgentIn = { slug: string; role: string; tools: string[]; stats?: { done?: number; failed?: number } };

/** configured: env/connection files only (no doctor run); available: with the doctor's latest checks. null = unknown, never "limited". */
export function workerCard(a: AgentIn, approval: ReadonlySet<string>, configured: DepState, available: DepState): WorkerCard {
  const deps = [...new Set<Dep>(["claude", ...a.tools.flatMap((t) => TOOL_DEPS[t] ?? [])])];
  const conns = deps.map((dep) => ({ dep, configured: available[dep] === true ? true : configured[dep], available: available[dep] }));
  return {
    slug: a.slug, domain: a.role.split(":")[0].trim(), tools: a.tools.filter((t) => t !== "delegate").map((name) => ({ name, approval: approval.has(name) })), conns,
    limited: conns.filter((c) => c.available === false || (c.available === null && c.configured === false)).map((c) => c.dep),
    done: a.stats?.done ?? 0, failed: a.stats?.failed ?? 0,
  };
}

/* ---------- night shift ---------- */

export type Planned = Pick<NightTask, "kind" | "ref" | "label">;
export type Outcome = NightItem["status"] | "not_run";
export type CompareRow = { kind: NightKind; label: string; planned: boolean; outcome: Outcome; why?: string };
export type Compare = { rows: CompareRow[]; planned: number; produced: number; skipped: number; failed: number; notRun: number; stopped?: string; success: boolean };

/** Morning report: every planned job with what became of it, plus anything run that wasn't planned. "Ran" isn't success:
 *  success needs at least one produced result (done or waiting for approval) and no failures. */
export function nightCompare(run: Pick<NightRun, "items" | "stopped"> & { planned?: Planned[] }): Compare {
  const key = (x: Planned) => `${x.kind}:${x.ref}`;
  const got = new Map(run.items.map((i) => [key(i), i]));
  const plan = run.planned ?? [];
  const rows: CompareRow[] = [
    ...plan.map((p) => { const i = got.get(key(p)); return { kind: p.kind, label: p.label, planned: true, outcome: (i?.status ?? "not_run") as Outcome, why: i?.why }; }),
    ...run.items.filter((i) => !plan.some((p) => key(p) === key(i))).map((i) => ({ kind: i.kind, label: i.label, planned: false, outcome: i.status as Outcome, why: i.why })),
  ];
  const n = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const produced = n("done") + n("approval");
  return { rows, planned: plan.length, produced, skipped: n("skipped"), failed: n("failed"), notRun: n("not_run"), stopped: run.stopped, success: produced > 0 && !n("failed") };
}

/** Tonight's budget against the selected jobs. */
export const nightBudget = (queue: Pick<NightTask, "calls" | "minutes">[], s: Pick<NightSettings, "maxCalls" | "maxMinutes">) => ({
  calls: queue.reduce((a, t) => a + t.calls, 0), minutes: queue.reduce((a, t) => a + t.minutes, 0), maxCalls: s.maxCalls, maxMinutes: s.maxMinutes,
});

/* ---------- AGT07 scorecards, AGT02 routing ---------- */


export const MIN_SAMPLE = 5, MIN_LEAD = 10; // finished units per agent+class before any comparison; percentage points to switch
export type Scorecard = {
  agent: string; cls: WorkflowType; n: number; success: Rate; verified: Rate; rework: Rate; intervention: Rate;
  /** median minutes per finished unit (all its attempts), null when none is timed; timed = how many had times */
  minutes: number | null; timed: number;
  /** usage rows carry no task id, so cost is never attributed per agent: covered 0 of n, shown as unavailable */
  costCovered: 0; enough: boolean;
};
const mins = (u: Unit) => {
  const ts = u.attempts.map((t) => Date.parse(t.finished_at ?? "") - Date.parse(t.started_at ?? t.created_at));
  return ts.length && ts.every((x) => Number.isFinite(x) && x >= 0) ? ts.reduce((a, b) => a + b, 0) / 60_000 : null;
};
/** Same denominators as ANALYTICS, split by agent × task class (workflow type), each with its sample size. */
export function scorecards(us: Unit[]): Scorecard[] {
  const g = new Map<string, Unit[]>();
  for (const u of us) { const k = `${u.last.agent}|${u.type}`; g.set(k, [...(g.get(k) ?? []), u]); }
  return [...g].map(([k, list]) => {
    const [agent, cls] = k.split("|") as [string, WorkflowType];
    const o = outcomeRates(list), r = reliability(list).find((x) => x.type === cls)!;
    const finished = list.filter((u) => r.success.all.includes(u.id)), m = finished.map(mins).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return { agent, cls, n: o.finished, success: r.success, verified: o.autonomous, rework: o.rework, intervention: o.intervention,
      minutes: m.length ? Math.round(m[Math.floor((m.length - 1) / 2)]) : null, timed: m.length, costCovered: 0 as const, enough: o.finished >= MIN_SAMPLE };
  }).sort((a, b) => a.cls.localeCompare(b.cls) || b.n - a.n);
}

export type Route = { cls: WorkflowType; agent: string | null; usual: string | null; why: "agt.rt.none" | "agt.rt.few" | "agt.rt.usual" | "agt.rt.close" | "agt.rt.better"; vars: Record<string, string | number> };
/** Per task class: the usual worker (most finished units) is the default. Another is suggested only when both have MIN_SAMPLE+
 *  finished units and its verified success leads by MIN_LEAD+ points. Never a claim from a tiny sample. */
export function routes(cards: Scorecard[]): Route[] {
  const classes = [...new Set(cards.map((c) => c.cls))];
  return classes.map((cls): Route => {
    const cs = cards.filter((c) => c.cls === cls).sort((a, b) => b.n - a.n);
    const usual = cs[0], v = (c: Scorecard) => pct(c.verified) ?? 0;
    if (!usual) return { cls, agent: null, usual: null, why: "agt.rt.none", vars: {} };
    if (!usual.enough) return { cls, agent: usual.agent, usual: usual.agent, why: "agt.rt.few", vars: { a: usual.agent, n: usual.n, min: MIN_SAMPLE } };
    const best = cs.filter((c) => c.enough).sort((a, b) => v(b) - v(a) || b.n - a.n)[0];
    if (best.agent === usual.agent) return { cls, agent: usual.agent, usual: usual.agent, why: "agt.rt.usual", vars: { a: usual.agent, p: v(usual), n: usual.n } };
    const lead = v(best) - v(usual);
    return lead >= MIN_LEAD
      ? { cls, agent: best.agent, usual: usual.agent, why: "agt.rt.better", vars: { a: best.agent, p: v(best), n: best.n, u: usual.agent, q: v(usual), m: usual.n } }
      : { cls, agent: usual.agent, usual: usual.agent, why: "agt.rt.close", vars: { a: usual.agent, b: best.agent, d: lead, min: MIN_LEAD } };
  });
}
