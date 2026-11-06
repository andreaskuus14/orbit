import type { SupabaseClient } from "@supabase/supabase-js";
import { continueWork, type Exec, type WorkGoal, type WorkTask } from "./work-continuation-pure.ts";
import { REPLAY_CASES } from "../../evals/agent-replay-cases.ts";

const COLS = "id, title, status, created_at, started_at, error, agent, request, pending, trace, automation_id";
const missingColumn = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /column .*origin/i.test(e.message ?? "");

/** Read-only summary: do not call GET /api/goals, which advances approved goals. `exec` gives execution evidence for running
 *  tasks (agents.ts taskExecution); tests pass their own. */
export async function getContinueWork(sb: SupabaseClient, userId: string, exec?: (id: string, startedAt: string | null | undefined) => Exec) {
  const signal = AbortSignal.timeout(4000);
  const evidence = exec ?? (await import("./agents").then((m) => m.taskExecution, () => () => "unknown" as const));
  const taskQuery = (cols: string) => Promise.resolve(sb.from("tasks").select(cols).eq("user_id", userId).is("parent_id", null)
    .in("status", ["queued", "running", "awaiting_approval", "failed"]).order("created_at", { ascending: false }).limit(30).abortSignal(signal));
  const [tasks, goals] = await Promise.allSettled([
    taskQuery(`${COLS}, origin`).then(async (r) => { // origin arrives with migration 0025; before it, evaluations are matched by their case
      const rr = r.error && missingColumn(r.error) ? await taskQuery(COLS) : r;
      if (rr.error) throw rr.error;
      return rr.data as unknown as WorkTask[];
    }),
    Promise.resolve(sb.from("goals").select("id, doc, updated_at").eq("user_id", userId)
      .in("status", ["draft", "approved", "running", "waiting", "paused", "blocked"]).order("updated_at", { ascending: false }).limit(30).abortSignal(signal))
      .then((r) => { if (r.error) throw r.error; return r.data as WorkGoal[]; }),
  ]);
  const list = (tasks.status === "fulfilled" ? tasks.value ?? [] : []).map((t) => (t.status === "running" ? { ...t, exec: evidence(t.id, t.started_at) } : t));
  // Linked by automation_id (a real identifier, never the title): each automation's latest successful run, so an older failure
  // of the same automation reads as history.
  const autos = [...new Set(list.filter((t) => t.status === "failed" && t.automation_id).map((t) => t.automation_id!))];
  const newerOk: Record<string, string> = {};
  if (autos.length) {
    const { data } = await sb.from("tasks").select("automation_id, started_at, created_at").eq("user_id", userId).eq("status", "done").in("automation_id", autos)
      .order("created_at", { ascending: false }).limit(50).abortSignal(signal);
    for (const d of (data ?? []) as { automation_id: string; started_at: string | null; created_at: string }[]) newerOk[d.automation_id] ??= d.started_at ?? d.created_at;
  }
  return continueWork(list, goals.status === "fulfilled" ? goals.value ?? [] : [],
    [tasks.status === "rejected" ? "Tasks could not be loaded." : "", goals.status === "rejected" ? "Goals could not be loaded." : ""].filter(Boolean), REPLAY_CASES, newerOk);
}
