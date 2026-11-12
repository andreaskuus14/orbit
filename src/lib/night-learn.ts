import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_AGE, kindStats, learnPlan, outcomes, type Learned, type TaskEvent } from "./night-learn-pure";
import type { NightSettings } from "./night-pure";

// Night shift v3 I/O (logic: night-learn-pure.ts): his night.task results from the ledger + his decisions.
// Read-only; on any failure the plan just isn't learned tonight (empty weights, nothing dropped).
export async function learnedPlan(sb: SupabaseClient, userId: string, s: NightSettings, key: string, now = Date.now()): Promise<Learned> {
  try {
    const { data, error } = await sb.from("events").select("created_at, payload").eq("user_id", userId).eq("type", "night.task").gte("created_at", new Date(now - MAX_AGE).toISOString()).limit(2000);
    if (error) throw error;
    const events = (data ?? []).map((e): TaskEvent => ({ at: new Date(e.created_at).toISOString(), ...(e.payload as Pick<TaskEvent, "kind" | "status">) }));
    return learnPlan(kindStats(outcomes(events), now), s.pin ?? {}, key);
  } catch (e) {
    console.warn("[orbit] night learning skipped:", e instanceof Error ? e.message : e);
    return { weight: {}, drop: [], stats: [] };
  }
}
