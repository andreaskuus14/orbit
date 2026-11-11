import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase/admin";
import { runPulse } from "./pulse";
import { handleEvents, runDueAutomations } from "./automations";
import { kickQueue } from "./agents";
import { resumeChains } from "./chains";
import { dueSlots, type BriefingKind } from "./pure";
import { generateProposals, proposalsDue } from "./proactive";
import { maybeBackup } from "./backup";
import { stopAllOn } from "./stop-all";
import { usageHold, usageLimited } from "./usage-meter";
import { maybeSleep } from "./sleep";
import { maybeWeeklyScout } from "./niche";
import { maybeNightShift, nightOwnsCompany } from "./night";
import { maybeDealHunt } from "./deals";
import { maybeScorecard } from "./agent-replay";
import { maybeArchDigest } from "./arch-digest";
import { allows, tickAutonomy } from "./autonomy";
import { beat } from "./host-heartbeat";

// Server-side scheduler (briefings + automations): runs inside the ORBIT server process (npm run dev / npm start), so briefings
// happen without a browser open. It needs SUPABASE_SECRET_KEY to act for the user with no session.
// Missed slots (PC asleep) are caught up within a few hours, never twice.

const TICK_MS = 60_000;
const g = globalThis as unknown as { __orbitScheduler?: NodeJS.Timeout; __orbitTick?: unknown; __orbitBusy?: boolean; __orbitWarned?: boolean; __orbitCapsuleFallback?: boolean };

async function tick(sb: SupabaseClient) {
  if (g.__orbitBusy) return;
  g.__orbitBusy = true;
  try {
    const { data: users, error } = await sb.from("profiles").select("id");
    if (error) throw error;
    // Event-triggered automations first (they should feel instant), then scheduled ones, then briefings.
    await handleEvents(sb).catch((e) => console.error("[orbit] automation events failed:", e?.message ?? e)); // still advances its cursor: startAutomation refuses while Stop-all is on
    void import("./ntfy").then((m) => m.tickNtfy(sb)); // phone notifications for finished/failed/waiting tasks; drops them while Stop-all is on
    if (stopAllOn()) return; // Stop-all: no automations, queue starts, chain resumes, briefings, proposals or backups
    void import("./habit-nudge").then((m) => m.tickHabits()).catch((e) => console.error("[orbit] habit nudges failed:", e instanceof Error ? e.message : e)); // LIFE, local, no model
    if (allows("calls", "background").ok) void import("./call").then((c) => c.maybeCall()); // "ORBIT wants to talk": rings the paired phone when call-pure says so; never throws
    const limited = usageLimited(); // a real Claude limit: start nothing that needs Claude, and don't burn briefing slots (failed runs count as ran)
    for (const { id } of users ?? []) {
      if (limited) continue;
      await runDueAutomations(sb, id).catch((e) => console.error("[orbit] scheduled automations failed:", e?.message ?? e));
      if (id === users?.[0]?.id) await import("./rules").then((r) => r.tickRules(sb, [id])); // standing rules (Agents → Rules); never throws
      void kickQueue(sb, id); // tasks still queued after a restart (the in-process queue is gone) start again
      void import("./bg-resume").then((m) => m.resumeBackgroundTurns(sb, id)); // background CORE turns a restart cut off (bg-resume-pure.ts)
      void import("./approval-expiry").then((m) => m.expireApprovals(sb, id)); // agent approvals unanswered for 48 h → rejected, never approved
      void import("./plan-jobs").then((m) => m.tickPlanJobs(sb, id)); // plan-file jobs: one step per session, resumed from their plan file
      void nightOwnsCompany().then((night) => resumeChains(sb, id, night)).catch((e) => console.error("[orbit] agent teams resume failed:", e?.message ?? e)); // continue after approvals/restarts
      void import("./missions").then((m) => m.resumeMissions(sb, id)).catch((e) => console.error("[orbit] missions resume failed:", e?.message ?? e));
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
      if (!usageHold() && await proposalsDue(sb, id).catch(() => false)) { // background lane: waits near the usage budget / after a limit
        await generateProposals(sb, id).then(
          (rows) => console.log(`[orbit] agents proposed ${rows.length} new task(s)`),
          (e) => console.error("[orbit] proposals failed:", e instanceof Error ? e.message : e),
        );
      }
    }
    // Sleep loop: once a night 03:00–07:00, background lane; it re-checks Stop-all and usageHold itself.
    if (!limited && allows("memory", "background").ok) await maybeSleep(sb, (users ?? []).map((u) => u.id));
    // Episodic memory (episodes.ts): once a day from 02:00, ORBIT's own records → episode memories. No model call; not awaited.
    if (allows("memory", "background").ok) void import("./episodes").then((m) => m.maybeEpisodes(sb, (users ?? []).map((u) => u.id)));
    // Night shift (night.ts): in its window while the owner is idle, a bounded queue of safe work; not awaited. Re-checks Stop-all/usageHold per step.
    if (!limited) await maybeNightShift(sb, (users ?? []).map((u) => u.id));
    // Weekly BUSINESS niche scout (background lane, read-only web tools); not awaited: a run takes minutes. It re-checks Stop-all and usageHold itself.
    if (!limited && allows("research", "background").ok) void maybeWeeklyScout().catch((e) => console.error("[orbit] niche scout check failed:", e instanceof Error ? e.message : e));
    // Weekly YouTube outlier finder → IDEA RADAR (outliers.ts): read-only, scout quota share; quietly nothing without YOUTUBE_API_KEY. Not awaited; never throws.
    if (!limited && allows("research", "background").ok) void import("./outliers").then((m) => m.maybeWeeklyOutliers()).catch((e) => console.error("[orbit] weekly outliers failed:", e instanceof Error ? e.message : e));
    // Deal hunter (MARKETS → Deals): daytime, a wish at most every 6 h, daily call cap; not awaited. Re-checks Stop-all/usageHold itself.
    if (!limited && allows("deals", "background").ok) void maybeDealHunt(sb, (users ?? []).map((u) => u.id));
    // INTELLIGENCE → Watches (pagewatch.ts): due public pages, a few per tick, robots + polite; no model. Not awaited; never throws.
    if (allows("research", "background").ok) void import("./pagewatch").then((m) => m.tickWatches());
    // Profile → Autonomy "auto with limits" (off by default: a no-op until the owner turns it on with the typed phrase).
    if (users?.[0]) await tickAutonomy(sb, users[0].id);
    // Daily runs digest (daily.ts): once a day (ORBIT_DAILY_DIGEST, default 10:30) brief / clips / leads states to the phone, labels only. Never throws.
    if (users?.[0]) await import("./daily").then((m) => m.maybeDailyDigest(sb, users[0].id));
    // System health (doctor's SYSTEM card): every 10 min, incidents open/resolve; one phone push per new one (quiet hours wait). Not awaited; never throws.
    if (users?.[0]) void import("./system-health").then((m) => m.tickSystemHealth(sb, users[0].id));
    // Invoices: a phone push when an overdue reminder draft is waiting, once per invoice per week (quiet hours and Stop-all skip it).
    await import("./invoices").then((x) => x.pushInvoiceReminders(), () => {});
    // Monthly agent scorecard (ANALYTICS): not awaited, a run takes up to ~50 min; it re-checks Stop-all and usage itself.
    if (!limited) void maybeScorecard(sb, (users ?? []).map((u) => u.id));
    // ARCH weekly studio digest: Sunday from 17:00 (Monday catch-up); without Claude it still comes, focus from the numbers.
    await maybeArchDigest(sb, (users ?? []).map((u) => u.id)).catch((e) => console.error("[orbit] arch digest failed:", e instanceof Error ? e.message : e));
    // Weekly local backup (JSON export + uploaded files) to ORBIT_BACKUP_DIR, default ../orbit-backups.
    await maybeBackup(sb, (users ?? []).map((u) => u.id)).catch((e) => console.error("[orbit] backup failed:", e instanceof Error ? e.message : e));
    // Time capsule safety net: the night shift writes it on a PC that sleeps; an always-on host (or night shift off) needs this.
    // Not awaited (a backup can take a while); one at a time, and it records its own result for Profile and the next check.
    if (!g.__orbitCapsuleFallback) {
      g.__orbitCapsuleFallback = true;
      void import("./capsule").then(async (m) => { if (await m.fallbackBackupDue()) await m.runBackup(); })
        .catch((e) => console.error("[orbit] time capsule backup failed:", e instanceof Error ? e.message : e))
        .finally(() => { g.__orbitCapsuleFallback = false; });
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
  g.__orbitScheduler = setInterval(() => { void beat(); void tick(sb); }, TICK_MS); // beat outside tick: a long busy tick still beats
  setTimeout(() => { void beat(); void tick(sb); }, 15_000);
}
