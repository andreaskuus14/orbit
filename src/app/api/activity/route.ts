import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { readActivity } from "@/lib/activity";
import { undoActivity } from "@/lib/activity-undo";
import { ACT_AREAS, cleanUndo, withOpenUndo, autopilotItems, clipItems, goalItems, mergeActivity, taskItems } from "@/lib/activity-pure";
import { listJobs, readState, studioRoot } from "@/lib/clips/factory";

export const dynamic = "force-dynamic";

// Activity log (read-only): agent tasks (incl. team/goal steps, automation runs) with their tools + approvals, goal logs, clip uploads,
// autopilot clips, and activity.jsonl (Stop-all, CORE writes, autopilot approvals, usage limits). ?area= one of ACT_AREAS.
async function GET_(req: Request) {
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
    readActivity().then(withOpenUndo, () => []),
  ]);
  return Response.json({ items: mergeActivity([tasks, goals, jobs, auto, log], area || undefined, 200) });
}

// POST { undo: ActUndo, area? } → reverses one logged autonomous action (OPERATIONS → Activity / Time machine) and logs that it did.
async function POST_(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { undo?: unknown; area?: unknown } | null;
  const u = cleanUndo(b?.undo);
  if (!u) return Response.json({ error: "Expected { undo: { kind: 'memory', id } | { kind: 'vault-rename', id, to } | { kind: 'op', id } | { kind: 'pc', id } | { kind: 'term', id } | { kind: 'tm', id } }" }, { status: 400 });
  const r = await undoActivity(sb, user.id, u, b?.area);
  return Response.json(r.body, { status: r.status });
}
export const GET = guard("activity", GET_);
export const POST = guard("activity", POST_);
