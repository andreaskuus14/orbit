import { requireUser } from "@/lib/supabase/server";
import { getAgent, kickQueue } from "@/lib/agents";
import { str } from "@/lib/pure";
import { capabilityBlock } from "@/lib/capability";

const COLS = "id, parent_id, project_id, agent, title, request, status, result, error, trace, pending, created_at, started_at, finished_at";

// Last stale-task sweep per user: the AGENTS station polls this every 3 s, the sweep only needs to run once a minute.
const swept = new Map<string, number>();

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  // Tasks left "running" by a server restart can never finish: mark them failed so they don't look stuck.
  if (Date.now() - (swept.get(user.id) ?? 0) > 60_000) {
    swept.set(user.id, Date.now());
    await sb.from("tasks").update({ status: "failed", error: "Interrupted (ORBIT restarted). Press Retry.", finished_at: new Date().toISOString() })
      .eq("status", "running").lt("started_at", new Date(Date.now() - 20 * 60_000).toISOString());
  }
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

  const blocked = await capabilityBlock(request, body.lang === "et" || body.lang === "en" ? body.lang : undefined); // check before promising
  if (blocked) return Response.json({ error: blocked, blocked: true }, { status: 409 });
  const { data, error } = await sb.from("tasks").insert({ user_id: user.id, agent, title, request, project_id }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  void kickQueue(sb, user.id);
  return Response.json({ task: data }, { status: 201 });
}
