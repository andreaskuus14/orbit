import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runPulse } from "./pulse";
import { handleEvents, runDueAutomations } from "./automations";
import { dueSlots, type BriefingKind } from "./pure";
import { generateProposals, proposalsDue } from "./proactive";

// Server-side scheduler (briefings + automations): runs inside the ORBIT server process (npm run dev / npm start), so briefings
// happen without a browser open. It needs SUPABASE_SECRET_KEY to act for the user with no session.
// Missed slots (PC asleep) are caught up within a few hours, never twice.

const TICK_MS = 60_000;
const g = globalThis as unknown as { __orbitScheduler?: NodeJS.Timeout; __orbitTick?: unknown; __orbitBusy?: boolean; __orbitWarned?: boolean };

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function tick(sb: SupabaseClient) {
  if (g.__orbitBusy) return;
  g.__orbitBusy = true;
  try {
    const { data: users, error } = await sb.from("profiles").select("id");
    if (error) throw error;
    // Event-triggered automations first (they should feel instant), then scheduled ones, then briefings.
    await handleEvents(sb).catch((e) => console.error("[orbit] automation events failed:", e?.message ?? e));
    for (const { id } of users ?? []) {
      await runDueAutomations(sb, id).catch((e) => console.error("[orbit] scheduled automations failed:", e?.message ?? e));
      const since = new Date(Date.now() - 8 * 86400_000).toISOString();
      const { data: recent } = await sb.from("briefings").select("kind, created_at").eq("user_id", id).gte("created_at", since).order("created_at", { ascending: false });
      // Failed attempts count as "ran" too, so a broken feed doesn't retry every minute.
      const { data: failed } = await sb.from("job_runs").select("detail, started_at").eq("user_id", id).eq("job", "pulse").eq("status", "failed").gte("started_at", since);
      const last: Partial<Record<BriefingKind, string>> = {};
      for (const b of recent ?? []) last[b.kind as BriefingKind] ??= b.created_at;
      for (const f of failed ?? []) {
        const k = (f.detail ?? "").split(":")[0] as BriefingKind;
        if (!last[k] || last[k]! < f.started_at) last[k] = f.started_at;
      }
      for (const kind of dueSlots(new Date(), last)) {
        console.log(`[orbit] scheduled ${kind} briefing starting`);
        await runPulse(sb, id, kind).then(
          (r) => console.log(`[orbit] ${kind} briefing ready (${r.briefing.article_count} articles)`),
          (e) => console.error(`[orbit] ${kind} briefing failed:`, e instanceof Error ? e.message : e),
        );
      }
      // Proactive suggestions (every 6 h, daytime) — after briefings so they see the freshest news.
      if (await proposalsDue(sb, id).catch(() => false)) {
        await generateProposals(sb, id).then(
          (rows) => console.log(`[orbit] agents proposed ${rows.length} new task(s)`),
          (e) => console.error("[orbit] proposals failed:", e instanceof Error ? e.message : e),
        );
      }
    }
  } catch (e) {
    console.error("[orbit] scheduler tick failed:", e instanceof Error ? e.message : e);
  } finally {
    g.__orbitBusy = false;
  }
}

export function startScheduler() {
  if (g.__orbitScheduler && g.__orbitTick === tick) return; // already running this version
  if (g.__orbitScheduler) { clearInterval(g.__orbitScheduler); g.__orbitScheduler = undefined; } // code was updated: swap in the new tick
  const sb = adminClient();
  if (!sb) {
    if (!g.__orbitWarned) console.warn("[orbit] scheduled briefings are OFF: add SUPABASE_SECRET_KEY to .env.local to enable them");
    g.__orbitWarned = true;
    return;
  }
  console.log("[orbit] briefing scheduler on: Morning 07:30, Midday 12:30, Evening 19:00, Weekly Sun 18:30 (this PC's time)");
  g.__orbitTick = tick;
  g.__orbitScheduler = setInterval(() => void tick(sb), TICK_MS);
  setTimeout(() => void tick(sb), 15_000);
}
