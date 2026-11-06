import type { SupabaseClient } from "@supabase/supabase-js";
import { continueWork, isEvaluation, type Exec, type NewerRun, type WorkGoal, type WorkTask } from "./work-continuation-pure.ts";
import { rowReceipt } from "./receipt-pure.ts";
import { REPLAY_CASES } from "../../evals/agent-replay-cases.ts";

const COLS = "id, title, status, created_at, started_at, error, agent, request, pending, trace, automation_id";
const missingColumn = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /column .*origin/i.test(e.message ?? "");

/** Read-only summary: do not call GET /api/goals, which advances approved goals. `exec` gives execution evidence for running
 *  tasks (agents.ts taskExecution); tests pass their own. */
export async function getContinueWork(sb: SupabaseClient, userId: string, exec?: (id: string, startedAt: string | null | undefined) => Exec) {
  const signal = AbortSignal.timeout(4000);
  const evidence = exec ?? (await import("./agents").then((m) => m.taskExecution, () => () => "unchecked" as const)); // no evidence ≠ evidence of nothing
  // Evaluations are left out BEFORE the 30-row cap, so a run of scorecard replays can't push his own work off the card: with
  // migration 0025 the database filters on origin; older rows are matched by their exact case, page by page.
  // shortcut: scans at most 5 pages (150 rows) of open tasks; raise PAGES if one ever holds more evaluations than that.
  const PAGE = 30, PAGES = 5;
  let unchecked = false; // the scan stopped at PAGES with more rows left and fewer than PAGE of his tasks found
  const loadTasks = async (withOrigin: boolean) => {
    const out: WorkTask[] = [];
    unchecked = false;
    for (let i = 0; i < PAGES && out.length < PAGE; i++) {
      let q = sb.from("tasks").select(withOrigin ? `${COLS}, origin` : COLS).eq("user_id", userId).is("parent_id", null)
        .in("status", ["queued", "running", "awaiting_approval", "failed"]);
      if (withOrigin) q = q.or("origin.is.null,origin.neq.scorecard");
      const r = await q.order("created_at", { ascending: false }).range(i * PAGE, i * PAGE + PAGE - 1).abortSignal(signal);
      if (r.error) throw r.error;
      const rows = (r.data ?? []) as unknown as WorkTask[];
      out.push(...rows.filter((t) => !isEvaluation(t, REPLAY_CASES)));
      if (rows.length < PAGE) break;
      if (i === PAGES - 1 && out.length < PAGE) unchecked = true;
    }
    return out.slice(0, PAGE);
  };
  const [tasks, goals] = await Promise.allSettled([
    loadTasks(true).catch((e) => (missingColumn(e) ? loadTasks(false) : Promise.reject(e))), // origin arrives with migration 0025
    Promise.resolve(sb.from("goals").select("id, doc, updated_at").eq("user_id", userId)
      .in("status", ["draft", "approved", "running", "waiting", "paused", "blocked"]).order("updated_at", { ascending: false }).limit(30).abortSignal(signal))
      .then((r) => { if (r.error) throw r.error; return r.data as WorkGoal[]; }),
  ]);
  const list = (tasks.status === "fulfilled" ? tasks.value ?? [] : []).map((t) => (t.status === "running" ? { ...t, exec: evidence(t.id, t.started_at) } : t));
  // Linked by automation_id (a real identifier, never the title): each automation's latest later run whose receipt doesn't say it
  // failed. A "done" status alone isn't success: its receipt decides (verified / unverified; failed and partly don't count).
  const autos = [...new Set(list.filter((t) => t.status === "failed" && t.automation_id).map((t) => t.automation_id!))];
  const newerOk: Record<string, NewerRun> = {};
  if (autos.length) {
    const { data } = await sb.from("tasks").select("automation_id, title, request, status, error, pending, trace, started_at, created_at").eq("user_id", userId).eq("status", "done").in("automation_id", autos)
      .order("created_at", { ascending: false }).limit(50).abortSignal(signal);
    for (const d of (data ?? []) as (WorkTask & { automation_id: string })[]) {
      const rc = rowReceipt({ title: d.title, status: d.status, error: d.error, request: d.request, pending: Array.isArray(d.pending) ? d.pending : null, trace: d.trace ?? null });
      if (newerOk[d.automation_id] || rc?.status === "failed" || rc?.status === "partly") continue;
      newerOk[d.automation_id] = { at: d.started_at ?? d.created_at, verified: rc?.status === "verified" };
    }
  }
  return continueWork(list, goals.status === "fulfilled" ? goals.value ?? [] : [],
    [tasks.status === "rejected" ? "Tasks could not be loaded." : "", goals.status === "rejected" ? "Goals could not be loaded." : "",
      unchecked ? "Some older tasks weren't checked." : ""].filter(Boolean), REPLAY_CASES, newerOk); // a problem line: the card never says "caught up" with one
}
