import { requireUser } from "@/lib/supabase/server";
import { stopAllOn } from "@/lib/stop-all";
import { focusActive } from "@/lib/focus";
import { callLive } from "@/lib/call";
import { pendingApprovals } from "@/lib/remote";
import { commitments } from "@/lib/dayplan";
import { calendarEvents } from "@/lib/gcal";
import { openIncidents } from "@/lib/system-health";
import { localDay } from "@/lib/morning-pure";
import { loopsDueToday } from "@/lib/speak-first-pure";

export const dynamic = "force-dynamic";

/** "ORBIT speaks first": what the client decider needs when he comes back to the PC. Reads stored state only (no probes, no model);
 *  the calendar read uses gcal's 5-min cache. Every source fails soft to empty. */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const now = Date.now();
  const [approvals, inbox, events, incidents] = await Promise.all([
    pendingApprovals(sb).catch(() => []), commitments().catch(() => []), calendarEvents(1, now).catch(() => null), openIncidents().catch(() => []),
  ]);
  return Response.json({
    stopAll: stopAllOn(), focus: focusActive(now), inCall: callLive(),
    incidents: incidents.map((i) => ({ key: i.key, title: i.title })),
    approvals: approvals.map((a) => ({ id: a.id, title: a.title, seen: a.seen })),
    loopsToday: loopsDueToday(inbox, localDay(new Date(now))),
    events: (events ?? []).map((e) => ({ title: e.title, start: e.start, allDay: e.allDay })),
  });
}
