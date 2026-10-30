import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FAST_MODEL, askClaude, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHardHold, usageView } from "./usage-meter";
import { createMemory, searchMemories } from "./memory";
import { nicheBoard } from "./niche";
import { listGoals } from "./goals";
import { calendarEvents } from "./gcal";
import { ledgerEvidence } from "./twin";
import { ADVOCATE_SYSTEM, CROSS_SYSTEM, JUDGE_SYSTEM, MAX_CALLS, advocatePrompt, buildFacts, courtMemory, crossPrompt, failedAttack, failedBrief, judgePrompt, normalizeWeights, rescore,
  parseAttack, parseBrief, parseCase, parseVerdict, planRounds, plannedCalls, type Brief, type CourtResult } from "./court-pure";

// Agent courtroom I/O (rules: court-pure.ts). Fast model only, at most MAX_CALLS calls, only on his click, gated by
// Stop-all and the usage hold. Results stay in memory until he keeps one as a decision memory.
const g = globalThis as unknown as { __orbitCourt?: Map<string, CourtResult> };
const results = () => (g.__orbitCourt ??= new Map());
const CALL_MS = 60_000;
const held = () => (stopAllOn() ? PAUSED_MSG : usageHardHold());

/** What a run costs, shown before he clicks. */
export function courtCost(options: number) {
  const u = usageView();
  return { calls: plannedCalls(Math.min(3, Math.max(2, options))), maxCalls: MAX_CALLS, model: FAST_MODEL, used5h: u.h5.calls, budget5h: u.settings.calls5h, held: held() };
}

async function gatherFacts(sb: SupabaseClient, userId: string, question: string) {
  const safe = <T,>(p: Promise<T>, empty: T) => p.catch((e) => { console.warn("[orbit] court data source failed", e instanceof Error ? e.message : e); return empty; });
  const [mem, board, goals, calendar, ledger] = await Promise.all([
    safe(searchMemories(sb, question, 12, userId), { results: [], mode: "" }), // journal excluded by default (LIFE data never goes to a model)
    safe(nicheBoard(), null), safe(listGoals(sb, userId), []), safe(calendarEvents(14), null), safe(ledgerEvidence(sb, userId, "argue"), []),
  ]);
  return buildFacts({ memories: mem.results, niches: board?.niches, goals: goals.map((r) => ({ title: r.doc.title, status: r.status, deadline: r.doc.deadline, why: r.doc.why })), calendar, ledger });
}

export async function runCourt(sb: SupabaseClient, userId: string, raw: unknown, reqSignal?: AbortSignal): Promise<CourtResult> {
  const c = parseCase(raw);
  if (typeof c === "string") throw Object.assign(new Error(c), { status: 400 });
  const h = held();
  if (h) throw new Error(h);
  const plan = planRounds(c.options.length);
  const ac = new AbortController(), watch = setInterval(() => { if (stopAllOn()) ac.abort(new Error(PAUSED_MSG)); }, 1000);
  const signal = reqSignal ? AbortSignal.any([reqSignal, ac.signal]) : ac.signal;
  let calls = 0;
  const ask = async (prompt: string, system: string, purpose: string) => {
    if (stopAllOn()) throw new Error(PAUSED_MSG);
    if (++calls > plan.length) throw new Error("court call cap reached"); // never more than the plan he saw
    const r = await askClaude(prompt, system, { lane: "foreground", model: FAST_MODEL, signal, timeoutMs: CALL_MS, purpose });
    void recordUsage(sb, userId, purpose, r, FAST_MODEL).catch(() => {});
    return r.text;
  };
  try {
    const facts = await gatherFacts(sb, userId, c.question);
    const cases = plan.filter((p) => p.round === "case"), cross = plan.flatMap((p) => (p.round === "cross" ? [p] : []));
    const briefs: Brief[] = await Promise.all(cases.map((p) => ask(advocatePrompt(c, p.side, facts), ADVOCATE_SYSTEM, "court.advocate").then((t) => parseBrief(t, p.side, facts), () => failedBrief(p.side))));
    signal.throwIfAborted();
    if (briefs.every((b) => b.failed)) throw new Error("No advocate answered; try again later");
    const attacks = await Promise.all(cross.map((p) => (briefs[p.target].failed ? Promise.resolve(failedAttack(p.side, p.target)) : ask(crossPrompt(c, p.side, briefs[p.target], facts), CROSS_SYSTEM, "court.cross").then((t) => parseAttack(t, p.side, briefs[p.target]), () => failedAttack(p.side, p.target)))));
    signal.throwIfAborted();
    const verdict = await ask(judgePrompt(c, briefs, attacks), JUDGE_SYSTEM, "court.judge").then((t) => parseVerdict(t, c), (e) => { signal.throwIfAborted(); console.warn("[orbit] court judge failed", e instanceof Error ? e.message : e); return null; });
    const r: CourtResult = { id: randomUUID(), at: new Date().toISOString(), case: c, briefs, attacks, verdict, calls, facts: facts.length };
    const m = results();
    m.set(r.id, r);
    for (const k of [...m.keys()].slice(0, Math.max(0, m.size - 20))) m.delete(k);
    return r;
  } finally { clearInterval(watch); }
}

/** He keeps a verdict: it becomes a decision memory. Only results this server produced can be kept (the page can't write one). */
export async function keepCourt(sb: SupabaseClient, userId: string, id: unknown, rawWeights?: unknown) {
  let r = typeof id === "string" ? results().get(id) : undefined;
  if (!r) throw Object.assign(new Error("That verdict is gone (server restarted); run it again"), { status: 404 });
  const w = rawWeights === undefined ? r.case.weights : normalizeWeights(rawWeights); // he may have moved the sliders after the verdict
  if (typeof w === "string") throw Object.assign(new Error(w), { status: 400 });
  r = { ...r, case: { ...r.case, weights: w }, verdict: r.verdict && { ...r.verdict, ...rescore(r.verdict.scores, w) } };
  const { memory } = await createMemory(sb, userId, { kind: "decision", source: "court", tags: ["courtroom"], ...courtMemory(r) });
  results().delete(r.id);
  return memory.id as string;
}
