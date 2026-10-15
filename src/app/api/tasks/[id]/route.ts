import { requireUser } from "@/lib/supabase/server";
import { ConflictError, kickQueue, resolvePending } from "@/lib/agents";

const COLS = "id, parent_id, project_id, agent, title, request, status, result, error, trace, pending, created_at, started_at, finished_at";
type Ctx = { params: Promise<{ id: string }> };

/** A task with its delegated sub-tasks (one level is enough: deeper ones are listed under their parent). */
export async function GET(_: Request, { params }: Ctx) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { data: task, error } = await sb.from("tasks").select(COLS).eq("id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!task) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: children } = await sb.from("tasks").select(COLS).eq("parent_id", id).order("created_at");
  return Response.json({ task, children: children ?? [] });
}

/** approve | reject (pending actions), retry (failed/cancelled), cancel (queued). */
export async function POST(req: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  try {
    if (action === "approve" || action === "reject") {
      const pending = await resolvePending(sb, user.id, id, action === "approve");
      void kickQueue(sb, user.id); // approved follow-up tasks start now
      return Response.json({ pending });
    }
    if (action === "retry") {
      const { data, error } = await sb.from("tasks").update({ status: "queued", error: null, result: null, trace: [], pending: [], started_at: null, finished_at: null })
        .eq("id", id).in("status", ["failed", "cancelled"]).is("parent_id", null).select("id");
      if (error) throw error;
      if (!data?.length) return Response.json({ error: "Only failed or cancelled tasks can be retried" }, { status: 400 });
      void kickQueue(sb, user.id);
      return Response.json({ ok: true });
    }
    if (action === "cancel") {
      const { data, error } = await sb.from("tasks").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "queued").select("id");
      if (error) throw error;
      if (!data?.length) return Response.json({ error: "Only queued tasks can be cancelled" }, { status: 400 });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof ConflictError ? 409 : 400 });
  }
}
