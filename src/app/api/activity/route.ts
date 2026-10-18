import { requireUser } from "@/lib/supabase/server";
import { readActivity } from "@/lib/activity";
import { ACT_AREAS, autopilotItems, clipItems, goalItems, mergeActivity, taskItems } from "@/lib/activity-pure";
import { listJobs, readState, studioRoot } from "@/lib/clips/factory";

export const dynamic = "force-dynamic";

// Activity log (read-only): agent tasks (incl. team/goal steps, automation runs) with their tools + approvals, goal logs, clip uploads,
// autopilot clips, and activity.jsonl (Stop-all, CORE writes, autopilot approvals, usage limits). ?area= one of ACT_AREAS.
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const area = new URL(req.url).searchParams.get("area") ?? "";
  if (area && !(ACT_AREAS as readonly string[]).includes(area)) return Response.json({ error: `area must be one of ${ACT_AREAS.join(", ")}` }, { status: 400 });
  const want = (a: string[]) => !area || a.includes(area);
  const none = Promise.resolve([]);
  const [tasks, goals, jobs, auto, log] = await Promise.all([
    want(["agents", "chains", "goals", "automations"]) ? sb.from("tasks").select("id, parent_id, agent, title, status, automation_id, error, trace, pending, created_at, started_at, finished_at")
      .order("created_at", { ascending: false }).limit(60).then((r) => taskItems(r.data ?? [])) : none,
    want(["goals"]) ? sb.from("goals").select("doc").order("updated_at", { ascending: false }).limit(30).then((r) => goalItems(r.data ?? [])) : none,
    want(["clips"]) ? listJobs().then(clipItems, () => []) : none,
    want(["autopilot"]) ? readState<{ tracked?: { title: string; channel: string; at: string; auto: boolean }[] }>(studioRoot(), "autopilot", () => "", true) // keep: a read-only view never quarantines
      .then((a) => autopilotItems(Array.isArray(a?.tracked) ? a.tracked : []), () => []) : none,
    readActivity().catch(() => []),
  ]);
  return Response.json({ items: mergeActivity([tasks, goals, jobs, auto, log], area || undefined, 200) });
}
