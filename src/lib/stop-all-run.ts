import type { SupabaseClient } from "@supabase/supabase-js";
import { setStopAll, stopAllState } from "@/lib/stop-all";
import { logActivity } from "@/lib/activity";
import { cancelTask, kickQueue, liveTaskIds } from "@/lib/agents";
import { resumeChains } from "@/lib/chains";
import { abortGoalDrivers, resumeGoals } from "@/lib/goals";
import { resumeClipQueue } from "@/lib/clips/factory";
import { abortNicheWork } from "@/lib/niche";
import { pushNotify } from "@/lib/remote-push";
import { abortNightShift } from "@/lib/night";
import { abortDealHunt } from "@/lib/deals";
import { clearAutoQueue } from "@/lib/autonomy";

/** Turn Stop-all on (cancelling running tasks/teams/goal drivers) or off (resuming queues). Used by /api/stop-all and the phone remote. */
export async function switchStopAll(sb: SupabaseClient, userId: string, on: boolean, via = "") {
  let saveError = "";
  const stop = await setStopAll(on).catch((e) => { saveError = e instanceof Error ? e.message : String(e); return stopAllState(); });
  let cancelled = 0, goals = 0;
  if (on) {
    for (const id of liveTaskIds()) if (await cancelTask(sb, id).catch(() => false)) cancelled++; // tasks and team chains (their drivers are in the same map)
    goals = abortGoalDrivers();
    abortNicheWork(); // BUSINESS niche scout / shop build
    abortNightShift(); // the night shift's current step (its agent task is also in liveTaskIds above)
    abortDealHunt(); // a running deal hunt (MARKETS → Deals)
    await clearAutoQueue(); // Profile → Autonomy: queued auto sends/publishes are cancelled
    await import("@/lib/ws-server").then((m) => m.stopAllServers()).catch(() => 0); // local workspace demo servers
    await import("@/lib/rojo").then((m) => m.stopServe()).catch(() => false); // rojo serve started from GAME DEV → Files
    pushNotify("stop");
  } else {
    resumeClipQueue(); void kickQueue(sb, userId); void resumeChains(sb, userId).catch(() => {}); void resumeGoals(sb, userId).catch(() => {}); // don't wait for the next tick
  }
  logActivity({ area: "system", title: (on ? "Stop-all turned ON: ORBIT paused" : "Stop-all turned off: ORBIT resumed") + via, detail: on ? `${cancelled} running task(s)/team(s) cancelled, ${goals} goal driver(s) stopped` : undefined });
  return { stop, cancelled, goals, ...(saveError ? { warning: `Active now, but not saved to disk (${saveError}): it resets on restart` } : {}) };
}
