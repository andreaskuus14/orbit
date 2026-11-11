import { requireUser } from "@/lib/supabase/server";
import { traceExport } from "@/lib/trace-export-pure";

const COLS = "id, parent_id, agent, title, request, status, result, error, trace, pending, created_at, started_at, finished_at";
type Ctx = { params: Promise<{ id: string }> };

/** S07: the run (task + two delegation levels, as the task view loads it) as a redacted JSON download, safe to share for debugging. */
export async function GET(_: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { data: task, error } = await sb.from("tasks").select(COLS).eq("user_id", user.id).eq("id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!task) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: kids } = await sb.from("tasks").select(COLS).eq("user_id", user.id).eq("parent_id", id).order("created_at").limit(100);
  const { data: nested } = kids?.length ? await sb.from("tasks").select(COLS).eq("user_id", user.id).in("parent_id", kids.map((k) => k.id)).order("created_at").limit(100) : { data: [] };
  const body = JSON.stringify(traceExport([task, ...(kids ?? []), ...(nested ?? [])], new Date().toISOString()), null, 2);
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="orbit-trace-${id.replace(/[^\w-]/g, "").slice(0, 36)}.json"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
