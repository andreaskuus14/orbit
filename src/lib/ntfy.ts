// ntfy phone notifications, IO side (rules + privacy: ntfy-pure.ts). Two feeds: every Web Push label (remote-push.ts deliver → ntfyPush),
// and top-level agent tasks reaching done / failed / awaiting approval (tickNtfy, a durable events consumer: crash-safe, at most one
// repeat). Stop-all drops everything but the Stop-all notice; quiet hours (ORBIT_QUIET_HOURS) hold back all but failures.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ackEvent, claimEvents } from "./durable";
import { stopAllOn } from "./stop-all";
import { parseQuiet, type PushMessage } from "./remote-push-pure";
import { fromPush, ntfyAllowed, ntfyConfig, publishBody, taskMsg, type NtfyConfig, type NtfyMsg } from "./ntfy-pure";
import { rowReceipt } from "./receipt-pure";

export const quietHours = () => parseQuiet(process.env.ORBIT_QUIET_HOURS);
const cfg = () => ntfyConfig(process.env, quietHours());
/** ntfy is set up and valid. */
export const ntfyReady = (): NtfyConfig | null => { const c = cfg(); return c && !("problem" in c) ? c : null; };
/** The owner-facing problem line ("" = fine or simply off), for System health. */
export const ntfyProblem = () => { const c = cfg(); return c && "problem" in c ? c.problem : ""; };

/** Publish one message. Never throws; false when off, held (Stop-all / quiet hours) or refused. */
export async function ntfySend(m: NtfyMsg, now = Date.now()): Promise<boolean> {
  const c = ntfyReady();
  if (!c || !ntfyAllowed(m.kind, now, c.quiet, stopAllOn())) return false;
  try {
    const res = await fetch(c.server, { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(publishBody(c, m)) });
    if (!res.ok) console.error("[ntfy] refused:", res.status);
    return res.ok;
  } catch (e) { console.error("[ntfy]", e instanceof Error ? e.message : e); return false; }
}

/** A Web Push label, mirrored to ntfy. */
export const ntfyPush = (m: PushMessage) => { const c = ntfyReady(); return c ? ntfySend(fromPush(m, c.open)) : Promise.resolve(false); };

/** Scheduler tick (before its Stop-all return): task events → one notification each. Off = nothing claimed (starts fresh when set up). */
export async function tickNtfy(sb: SupabaseClient) {
  const c = ntfyReady();
  if (!c) return;
  try {
    for (const e of await claimEvents(sb, "ntfy", ["agent.completed", "agent.failed"])) {
      const id = (e.payload as { taskId?: unknown } | null)?.taskId;
      if (typeof id === "string" && !stopAllOn()) {
        const { data: t } = await sb.from("tasks").select("status, parent_id, title, request, error, pending, trace").eq("id", id).maybeSingle();
        const m = t && !t.parent_id ? taskMsg(t.status, rowReceipt(t)?.status ?? null, c.open) : null;
        if (m) await ntfySend(m);
      }
      await ackEvent("ntfy", e.id);
    }
  } catch (e) { console.error("[ntfy] tick:", e instanceof Error ? e.message : e); }
}
