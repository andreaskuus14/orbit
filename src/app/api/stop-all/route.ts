import { requireUser } from "@/lib/supabase/server";
import { stopAllState, setStopAll } from "@/lib/stop-all";
import { usageView } from "@/lib/usage-meter";
import { logActivity } from "@/lib/activity";
import { cancelTask, kickQueue, liveTaskIds } from "@/lib/agents";
import { resumeChains } from "@/lib/chains";
import { abortGoalDrivers, resumeGoals } from "@/lib/goals";
import { resumeClipQueue } from "@/lib/clips/factory";

export const dynamic = "force-dynamic";

// Global Stop-all. GET: {stop, hold, limit} (the HUD polls it: banner + bell on a usage limit). POST {on: boolean}.
// On: every entry point refuses new work (see src/lib/stop-all.ts); running agent tasks / team chains / goal steps are cancelled
// through their normal cancel paths. Clip renders and uploads already under way finish (killing them could leave broken files).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const u = usageView();
  return Response.json({ stop: stopAllState(), hold: u.hold, limit: u.limit });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const on = ((await req.json().catch(() => null)) as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") return Response.json({ error: "on must be true or false" }, { status: 400 });
  let saveError = "";
  const stop = await setStopAll(on).catch((e) => { saveError = e instanceof Error ? e.message : String(e); return stopAllState(); });
  let cancelled = 0, goals = 0;
  if (on) {
    for (const id of liveTaskIds()) if (await cancelTask(sb, id).catch(() => false)) cancelled++; // tasks and team chains (their drivers are in the same map)
    goals = abortGoalDrivers();
  } else {
    resumeClipQueue(); void kickQueue(sb, user.id); void resumeChains(sb, user.id).catch(() => {}); void resumeGoals(sb, user.id).catch(() => {}); // don't wait for the next tick
  }
  logActivity({ area: "system", title: on ? "Stop-all turned ON: ORBIT paused" : "Stop-all turned off: ORBIT resumed", detail: on ? `${cancelled} running task(s)/team(s) cancelled, ${goals} goal driver(s) stopped` : undefined });
  return Response.json({ stop, cancelled, goals, ...(saveError ? { warning: `Active now, but not saved to disk (${saveError}): it resets on restart` } : {}) });
}
