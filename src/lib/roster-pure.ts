// AGENTS workforce (AGT01/AGT05): what each worker can actually do right now, and the night shift's plan vs what it produced.
// Pure, client-safe; tested in tests/roster.test.ts. Data: /api/agents (tools, deps), /api/night (plan, last run). UI: AgentsStation.tsx.
import type { Dep, DepState } from "./capability-pure.ts";
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
