import { requireUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/agents";
import { startAutomation } from "@/lib/automations";
import { describeTrigger, validateAutomation } from "@/lib/pure";

const COLS = "id, user_id, name, enabled, trigger, schedule, event, kind_filter, agent, prompt, last_run_at, run_count, created_at";

/** Automations with a readable trigger and the status of their latest run (from the tasks they created). */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("automations").select(COLS).order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const ids = (data ?? []).map((a) => a.id);
  const { data: runs } = ids.length
    ? await sb.from("tasks").select("id, automation_id, status, created_at, error").in("automation_id", ids).order("created_at", { ascending: false }).limit(200)
    : { data: [] };
  const automations = (data ?? []).map((a) => {
    const mine = (runs ?? []).filter((r) => r.automation_id === a.id);
    return { ...a, when: describeTrigger(a), last: mine[0] ?? null, runs: mine.slice(0, 5) };
  });
  return Response.json({ automations, failing: automations.some((a) => a.enabled && a.last?.status === "failed") });
}

/** Create an automation, or {run: id} to run one now. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  if (typeof body.run === "string") {
    const { data: a } = await sb.from("automations").select(COLS).eq("id", body.run).maybeSingle();
    if (!a) return Response.json({ error: "Not found" }, { status: 404 });
    try { return Response.json({ task: await startAutomation(sb, a, "run manually") }); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not start" }, { status: 500 }); }
  }
  const v = validateAutomation(body);
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
  if (!(await getAgent(sb, v.spec.agent))) return Response.json({ error: `Unknown agent "${v.spec.agent}"` }, { status: 400 });
  const { data, error } = await sb.from("automations").insert({ ...v.spec, user_id: user.id }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ id: data.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id, enabled } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || typeof enabled !== "boolean") return Response.json({ error: "Bad request" }, { status: 400 });
  const { data, error } = await sb.from("automations").update({ enabled }).eq("id", id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const { data, error } = await sb.from("automations").delete().eq("id", id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
