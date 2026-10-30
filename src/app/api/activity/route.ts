import { requireUser } from "@/lib/supabase/server";
import { logActivity, readActivity } from "@/lib/activity";
import { emit } from "@/lib/claude";
import { cloudMove, cloudOnlyNames, renameFile, VaultError } from "@/lib/vault";
import { ACT_AREAS, cleanUndo, undoKey, withOpenUndo, autopilotItems, clipItems, goalItems, mergeActivity, taskItems } from "@/lib/activity-pure";
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
    readActivity().then(withOpenUndo, () => []),
  ]);
  return Response.json({ items: mergeActivity([tasks, goals, jobs, auto, log], area || undefined, 200) });
}

// POST { undo: ActUndo, area? } → reverses one logged autonomous action (Operator log, OPERATIONS → Activity) and logs that it did.
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { undo?: unknown; area?: unknown } | null;
  const u = cleanUndo(b?.undo);
  if (!u) return Response.json({ error: "Expected { undo: { kind: 'memory', id } | { kind: 'vault-rename', id, to } }" }, { status: 400 });
  const area = b?.area === "core" || b?.area === "system" ? b.area : "operator"; // same area as the original line, so the filter hides its Undo
  try {
    if (u.kind === "memory") {
      const { data, error } = await sb.from("memories").delete().eq("id", u.id).select("id, storage_path");
      if (error) return Response.json({ error: error.message }, { status: 400 });
      if (!data?.length) return Response.json({ error: "Already gone" }, { status: 404 });
      if (data[0].storage_path) await sb.storage.from("vault").remove([data[0].storage_path]).then(({ error: e }) => e && console.error("[orbit] undo: memory deleted but its file was not", e));
      await emit(sb, user.id, "memory.deleted", "memory", { id: u.id });
      logActivity({ area, title: "Undone: memory deleted", undid: undoKey(u) });
    } else {
      const name = await renameFile(u.id, u.to, await cloudOnlyNames(sb, user.id));
      const cloud = name === u.id ? "ok" : await cloudMove(sb, user.id, u.id, name);
      logActivity({ area, title: `Undone: VAULT "${u.id}" renamed back to "${name}"`, undid: undoKey(u) });
      return Response.json({ ok: true, name, cloud });
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof VaultError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e instanceof Error ? e.message : "Undo failed" }, { status: 500 });
  }
}
