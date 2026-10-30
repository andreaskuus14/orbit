// Offline per-agent eval scoring (AGENT-UPGRADE). Pure; tested in tests/agent-defs.test.ts; run by scripts/agent-evals.ts (npm run eval:agents).
// Two deterministic layers, no model: (1) readiness of an agent definition for each task, (2) acceptance checks on a recorded answer.
// Model-graded rubrics (task.judge) are never scored here: they go through recorded runs in `npm run eval:ai`.
import { selfCheck, type Contract, type Tier } from "./agent-defs-pure.ts";

export type SuiteTask = { id: string; agent: string; lang: "en" | "et"; tier: Tier; needs: string[]; request: string; seen: string;
  expect?: { has?: RegExp[]; not?: RegExp[] }; judge?: string };
export type Def = { slug: string; tools: string[]; instructions: string; tier?: Tier; contract?: Contract };

export function validateSuite(tasks: SuiteTask[], agents: string[]) {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (!/^[a-z0-9-]+$/.test(t.id) || ids.has(t.id)) throw new Error(`Bad or duplicate task id: ${t.id}`);
    ids.add(t.id);
    if (!agents.includes(t.agent)) throw new Error(`${t.id}: unknown agent ${t.agent}`);
    if (!t.request.trim()) throw new Error(`${t.id}: empty request`);
  }
  for (const a of agents) {
    const n = tasks.filter((t) => t.agent === a).length;
    if (n < 5 || n > 8) throw new Error(`${a}: needs 5-8 tasks, has ${n}`);
  }
}

/** Readiness checks of one definition for one task: each is pass/fail, named so a report says what's missing. */
export function readiness(d: Def | undefined, t: SuiteTask): { check: string; ok: boolean }[] {
  const p = d?.instructions ?? "", tools = d?.tools ?? [];
  return [
    { check: `tools: ${t.needs.join(", ") || "none needed"}`, ok: !!d && t.needs.every((n) => tools.includes(n)) },
    { check: "definition of done", ok: /DONE WHEN:/.test(p) },
    { check: "output contract", ok: /OUTPUT:/.test(p) },
    { check: "self-check step", ok: /SELF-CHECK/.test(p) },
    { check: "send/spend rule", ok: /never send/i.test(p) },
    { check: `model tier ${t.tier}`, ok: d?.tier === t.tier },
    ...(t.lang === "et" ? [{ check: "Estonian output rule", ok: /Estonian/.test(p) }] : []),
  ];
}

export type AgentScore = { agent: string; tasks: number; passed: number; total: number; pct: number; missing: string[]; unused: string[]; judged: number };
/** Per agent: share of readiness checks passed over its tasks, the failing checks, and tools no task needs (info only). */
export function scoreDefs(defs: Def[], tasks: SuiteTask[]): AgentScore[] {
  return [...new Set(tasks.map((t) => t.agent))].map((agent) => {
    const d = defs.find((x) => x.slug === agent), mine = tasks.filter((t) => t.agent === agent);
    const rs = mine.flatMap((t) => readiness(d, t)), passed = rs.filter((r) => r.ok).length;
    const needed = new Set(mine.flatMap((t) => t.needs));
    return { agent, tasks: mine.length, passed, total: rs.length, pct: Math.round((100 * passed) / rs.length),
      missing: [...new Set(rs.filter((r) => !r.ok).map((r) => r.check))], unused: (d?.tools ?? []).filter((x) => !needed.has(x)), judged: mine.filter((t) => t.judge).length };
  });
}

/** Acceptance on a recorded answer: the agent's own selfCheck contract plus the task's expectations. seen defaults to the fixture. */
export function scoreAnswer(t: SuiteTask, d: Def | undefined, answer: string, seen = t.seen): { ok: boolean; fails: string[] } {
  const fails = selfCheck(d?.contract, answer, { request: t.request, seen });
  for (const re of t.expect?.has ?? []) if (!re.test(answer)) fails.push(`expected ${re}`);
  for (const re of t.expect?.not ?? []) if (re.test(answer)) fails.push(`must not match ${re}`);
  return { ok: !fails.length, fails };
}

/** Recorded runs ([{id, answer, seen?}]) → per-agent pass counts; tasks without a run are pending, never passes. */
export function scoreRuns(defs: Def[], tasks: SuiteTask[], input: unknown) {
  if (!Array.isArray(input)) throw new Error("Results must be a JSON array of {id, answer, seen?}");
  const byId = new Map<string, { answer: string; seen?: string }>();
  for (const r of input as Record<string, unknown>[]) {
    if (typeof r?.id !== "string" || typeof r.answer !== "string") throw new Error("Each run needs string id and answer");
    if (byId.has(r.id)) throw new Error(`Duplicate run for ${r.id}`);
    byId.set(r.id, { answer: r.answer, seen: typeof r.seen === "string" ? r.seen : undefined });
  }
  const runs = tasks.filter((t) => byId.has(t.id)).map((t) => ({ id: t.id, agent: t.agent, ...scoreAnswer(t, defs.find((d) => d.slug === t.agent), byId.get(t.id)!.answer, byId.get(t.id)!.seen) }));
  return { runs, pending: tasks.filter((t) => !byId.has(t.id)).map((t) => t.id) };
}
