import type { SupabaseClient } from "@supabase/supabase-js";
import { continueWork, type WorkGoal, type WorkTask } from "./work-continuation-pure.ts";

/** Read-only summary: do not call GET /api/goals, which advances approved goals. */
export async function getContinueWork(sb: SupabaseClient, userId: string) {
  const signal = AbortSignal.timeout(4000);
  const [tasks, goals] = await Promise.allSettled([
    Promise.resolve(sb.from("tasks").select("id, title, status, created_at").eq("user_id", userId).is("parent_id", null)
      .in("status", ["queued", "running", "awaiting_approval", "failed"]).order("created_at", { ascending: false }).limit(30).abortSignal(signal))
      .then((r) => { if (r.error) throw r.error; return r.data as WorkTask[]; }),
    Promise.resolve(sb.from("goals").select("id, doc, updated_at").eq("user_id", userId)
      .in("status", ["draft", "approved", "running", "waiting", "paused", "blocked"]).order("updated_at", { ascending: false }).limit(30).abortSignal(signal))
      .then((r) => { if (r.error) throw r.error; return r.data as WorkGoal[]; }),
  ]);
  return continueWork(tasks.status === "fulfilled" ? tasks.value ?? [] : [], goals.status === "fulfilled" ? goals.value ?? [] : [],
    [tasks.status === "rejected" ? "Tasks could not be loaded." : "", goals.status === "rejected" ? "Goals could not be loaded." : ""].filter(Boolean));
}
