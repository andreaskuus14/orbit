import type { SupabaseClient } from "@supabase/supabase-js";
import { FAST_MODEL, askClaude, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHardHold } from "./usage-meter";
import { AGENT_SYSTEM, JUDGE_SYSTEM, PERSONAS, agentPrompt, judgePrompt, mergeIdeas, parseIdeas, parseJudge, voteTop, type HiveIdea, type HivePick } from "./hive-pure";

// The Hive: 6 persona agents in parallel (background lane, so the shared CLI limiter queues them and CORE keeps a slot),
// then one judge call. Failed/slow agents are skipped; the judge sees whatever came back. Pure rules: hive-pure.ts.
export type HiveResult = { top: HivePick[]; ideas: HiveIdea[]; minds: { persona: string; ok: boolean }[]; judged: boolean };

const AGENT_MS = 90_000;

export async function runHive(sb: SupabaseClient, userId: string, problem: string, reqSignal?: AbortSignal): Promise<HiveResult> {
  const held = stopAllOn() ? PAUSED_MSG : usageHardHold();
  if (held) throw new Error(held);
  // All 6 calls enqueue at once, so a check at enqueue isn't enough: Stop-all aborts queued AND running calls.
  const ac = new AbortController();
  const watch = setInterval(() => { if (stopAllOn()) ac.abort(new Error(PAUSED_MSG)); }, 1000);
  try { return await runHiveInner(sb, userId, problem, reqSignal ? AbortSignal.any([reqSignal, ac.signal]) : ac.signal); }
  finally { clearInterval(watch); }
}

async function runHiveInner(sb: SupabaseClient, userId: string, problem: string, signal: AbortSignal): Promise<HiveResult> {
  const ask = async (prompt: string, system: string, purpose: string) => {
    if (stopAllOn()) throw new Error(PAUSED_MSG);
    const r = await askClaude(prompt, system, { lane: "background", model: FAST_MODEL, signal, timeoutMs: AGENT_MS, purpose: "hive" });
    void recordUsage(sb, userId, purpose, r, FAST_MODEL).catch(() => {});
    return r.text;
  };
  const settled = await Promise.allSettled(PERSONAS.map((p) => ask(agentPrompt(problem, p), AGENT_SYSTEM, "hive.agent")));
  const lists = PERSONAS.map((p, i) => { const s = settled[i]; return { persona: p.name, ideas: s.status === "fulfilled" ? parseIdeas(s.value) : [] }; });
  const minds = lists.map((l) => ({ persona: l.persona, ok: l.ideas.length > 0 }));
  const ideas = mergeIdeas(lists);
  if (!ideas.length) {
    signal.throwIfAborted();
    const why = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")?.reason;
    throw new Error(`No mind came back with ideas${why instanceof Error ? `: ${why.message}` : ""}`);
  }
  if (ideas.length <= 3) return { top: voteTop(ideas), ideas, minds, judged: false }; // nothing to choose between
  try {
    return { top: parseJudge(await ask(judgePrompt(problem, ideas), JUDGE_SYSTEM, "hive.judge"), ideas), ideas, minds, judged: true };
  } catch (e) {
    signal.throwIfAborted();
    console.error("[orbit] hive judge failed; ranking by votes", e);
    return { top: voteTop(ideas), ideas, minds, judged: false };
  }
}
