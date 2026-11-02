// 48 h approval expiry, IO side (rules: approval-expiry-pure.ts). Runs on the scheduler tick; rejects through resolvePending (the same
// path as his Reject click: atomic claim, chains and parents settle), then marks the task's error as expired. Never throws.
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePending } from "./agents";
import { dueExpiries, expiredError, expiryMs } from "./approval-expiry-pure";

export async function expireApprovals(sb: SupabaseClient, userId: string, now = Date.now()) {
  const ms = expiryMs(process.env);
  if (!ms) return;
  try {
    const { data, error } = await sb.from("tasks").select("id, status, pending, started_at, created_at").eq("user_id", userId).eq("status", "awaiting_approval")
      .lt("created_at", new Date(now - ms).toISOString()).order("created_at", { ascending: false }).limit(50); // sub-tasks first: their parents then settle
    if (error) throw error;
    for (const t of dueExpiries(data ?? [], now, ms)) {
      try {
        await resolvePending(sb, userId, t.id, false);
        await sb.from("tasks").update({ error: expiredError(ms) }).eq("user_id", userId).eq("id", t.id).eq("status", "cancelled");
      } catch (e) { console.error("[orbit] approval expiry", t.id, e instanceof Error ? e.message : e); } // decided meanwhile: fine
    }
  } catch (e) { console.error("[orbit] approval expiry:", e instanceof Error ? e.message : e); }
}
