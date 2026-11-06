import { requireUser } from "@/lib/supabase/server";
import { getAgent, kickQueue } from "@/lib/agents";
import { str } from "@/lib/pure";
import { capabilityStart } from "@/lib/capability";
import { withHeadsUp } from "@/lib/capability-pure";

const COLS = "id, parent_id, project_id, agent, title, request, status, result, error, trace, pending, created_at, started_at, finished_at";

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  // No sweep on read: a task's age doesn't prove its worker died. Tasks a restart orphaned are marked interrupted by the scheduler
  // (kickQueue → reclaimInterrupted, keyed on this process's boot time), whether or not this screen is ever opened.
  const p = new URL(req.url).searchParams;
  let q = sb.from("tasks").select(COLS).is("parent_id", null).order("created_at", { ascending: false }).limit(60);
  if (p.get("agent")) q = q.eq("agent", p.get("agent")!);
  if (p.get("project")) q = q.eq("project_id", p.get("project")!);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ tasks: data });
}

/** Create a task for an agent (Nova by default) and start it as soon as a slot is free. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const request = str(body.request, 8000, 1);
  if (!request) return Response.json({ error: "Describe the task (max 8000 characters)" }, { status: 400 });
  const agent = (str(body.agent, 40) || "nova").toLowerCase();
  if (!(await getAgent(sb, agent))) return Response.json({ error: `Unknown agent "${agent}"` }, { status: 400 });
  const title = str(body.title, 200) || request.split("\n")[0].slice(0, 120);
  const project_id = typeof body.project_id === "string" && body.project_id ? body.project_id : null;

  // Check before promising: refuse only when Claude Code is known down; anything else missing goes on the task as a heads-up.
  const cap = await capabilityStart(request, body.lang === "et" || body.lang === "en" ? body.lang : undefined);
  if (cap.block) return Response.json({ error: cap.block }, { status: 503 });
  const { data, error } = await sb.from("tasks").insert({ user_id: user.id, agent, project_id, ...withHeadsUp(title, request, cap.headsUp) }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  void kickQueue(sb, user.id);
  return Response.json({ task: data }, { status: 201 });
}
