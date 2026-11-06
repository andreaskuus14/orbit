import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, createBudget, MODEL } from "./claude";
import { runTask, resolvePending, BUILTIN_AGENTS } from "./agents";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { usageHold, usageLimited } from "./usage-meter";
import { REPLAY_CASES } from "../../evals/agent-replay-cases";
import { ANSWER_CAP, JUDGE_SYSTEM, addRun, caseScore, estimateCalls, judgePrompt, monthKey, parseJudge, parseState, previousRun, scorecardDue, summarize, validateCases,
  type CaseResult, type JudgeAnswer, type ReplayRun, type ReplayState } from "./agent-replay-pure";

// Agent scorecard: replays the 10 fixtures in evals/agent-replay-cases.ts through the real agent path (runTask), then a blind
// rubric judge scores each answer (paired with last month's answer, in random order). Monthly from the scheduler, or on demand
// from ANALYTICS. Stops on Stop-all and usage limits; proposed writes are rejected automatically, so nothing is ever saved.
// State: <ORBIT data dir>/agent-scorecard.json (scores, judge reasons, capped answers for next month's pairing).

validateCases(REPLAY_CASES, BUILTIN_AGENTS.map((a) => a.slug));
const file = () => path.join(orbitDataDir(), "agent-scorecard.json");
const load = async () => parseState(await readFile(file(), "utf8").catch(() => ""));
async function store(s: ReplayState) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}
const g = globalThis as unknown as { __orbitScorecard?: { done: number; total: number } };

export async function scorecardView() {
  const s = await load(), last = s.runs.at(-1);
  return { ...summarize(s, REPLAY_CASES), estimate: { maxCalls: estimateCalls(REPLAY_CASES), lastCalls: last?.calls ?? null }, running: g.__orbitScorecard ?? null };
}

/** Why a run can't start (or must stop) now, else "". Monthly runs also wait while the usage meter holds background work. */
export const blocked = (monthly: boolean) => (stopAllOn() ? "Stop-all is on" : usageLimited() ? "Claude usage limit reached" : monthly ? usageHold() : "");

/** Reject every approval the replay's task tree proposed, so a scorecard run never writes. Children first. */
async function rejectProposals(sb: SupabaseClient, userId: string, rootId: string) {
  const tree = [rootId];
  for (let i = 0; i < tree.length && tree.length < 50; i++) {
    const { data } = await sb.from("tasks").select("id").eq("user_id", userId).eq("parent_id", tree[i]);
    tree.push(...(data ?? []).map((t) => t.id));
  }
  for (const id of tree.reverse()) {
    const { data } = await sb.from("tasks").select("status").eq("user_id", userId).eq("id", id).maybeSingle();
    if (data?.status === "awaiting_approval") await resolvePending(sb, userId, id, false).catch((e) => console.error("[orbit] scorecard reject failed", e));
  }
}

/** Run all cases once. Returns "" when started-and-finished, else why it didn't start. Never throws. */
export async function runScorecard(sb: SupabaseClient, userId: string, trigger: "monthly" | "manual"): Promise<string> {
  if (g.__orbitScorecard) return "A scorecard run is already in progress";
  const why = blocked(trigger === "monthly");
  if (why) return why;
  g.__orbitScorecard = { done: 0, total: REPLAY_CASES.length };
  const now = new Date();
  const run: ReplayRun = { id: now.toISOString(), month: monthKey(now), at: now.toISOString(), trigger, complete: false, calls: 0, cases: [] };
  try {
    const prev = previousRun(await load(), run.month);
    for (const c of REPLAY_CASES) {
      if (blocked(trigger === "monthly")) break; // partial run is kept, marked incomplete
      const result: CaseResult = { id: c.id, status: "failed", calls: 0, scores: null, score: null, reason: "" };
      run.cases.push(result);
      try {
        const { data: task, error } = await sb.from("tasks").insert({ user_id: userId, agent: c.agent, title: `Scorecard: ${c.title}`, request: c.request,
          status: "running", started_at: new Date().toISOString() }).select("id").single(); // never "queued": kickQueue could start it first (as night.ts, goals.ts)
        if (error) throw error;
        const budget = createBudget(5 * 60_000, c.calls);
        const out = await runTask(sb, userId, task.id, 0, budget);
        result.calls = budget.used; result.status = out.status;
        const { data: row } = await sb.from("tasks").select("pending").eq("id", task.id).maybeSingle();
        const actions = ((row?.pending ?? []) as { tool: string }[]).map((p) => p.tool);
        await rejectProposals(sb, userId, task.id);
        result.answer = (out.result ?? out.error ?? "").slice(0, ANSWER_CAP);
        if (out.status === "blocked") { // never ran; cancel the case's row so kickQueue doesn't run it later
          await sb.from("tasks").update({ status: "cancelled", error: out.error, finished_at: new Date().toISOString() }).eq("id", task.id).eq("status", "queued");
          result.reason = out.error ?? "Blocked"; continue;
        }
        if (out.status === "cancelled" || blocked(trigger === "monthly")) { result.reason = "Stopped before judging"; continue; }
        result.actions = actions;
        const cur: JudgeAnswer = { text: result.answer, status: out.status, actions };
        const old = prev?.cases.find((x) => x.id === c.id && x.answer && x.score != null);
        const answers = old ? [cur, { text: old.answer!, status: old.status, actions: old.actions ?? [] }] : [cur];
        const { prompt, order } = judgePrompt(c, answers, Math.random);
        result.calls++;
        const r = await askClaude(prompt, JUDGE_SYSTEM, { lane: "background", purpose: "scorecard.judge" });
        await recordUsage(sb, userId, "scorecard.judge", r, MODEL);
        const [mine, theirs] = parseJudge(r.text, c.rubric.length, order);
        if (!mine) { result.reason = "Judge reply unreadable: not scored"; continue; }
        result.scores = mine.scores; result.score = caseScore(mine.scores); result.reason = mine.reason;
        if (old) result.prevScore = theirs ? caseScore(theirs.scores) : null;
      } catch (e) {
        result.reason = `Error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
      } finally {
        run.calls += result.calls;
        g.__orbitScorecard.done++;
      }
    }
    run.complete = run.cases.length === REPLAY_CASES.length && run.cases.every((x) => x.score != null);
    await store(addRun(await load(), run));
    return "";
  } catch (e) {
    console.error("[orbit] scorecard run failed:", e instanceof Error ? e.message : e);
    return "Scorecard run failed";
  } finally {
    g.__orbitScorecard = undefined;
  }
}

/** Scheduler tick: at most one run per calendar month (claimed first, so a crash can't run it twice). Never throws. */
export async function maybeScorecard(sb: SupabaseClient, userIds: string[], now = new Date()) {
  try {
    const s = await load();
    if (g.__orbitScorecard || !scorecardDue(now, s) || blocked(true)) return;
    await store({ ...s, claimedMonth: monthKey(now) });
    for (const id of userIds) await runScorecard(sb, id, "monthly");
  } catch (e) { console.error("[orbit] monthly scorecard failed:", e instanceof Error ? e.message : e); }
}
