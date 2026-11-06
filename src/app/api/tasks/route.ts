import { requireUser } from "@/lib/supabase/server";
import { getAgent, kickQueue } from "@/lib/agents";
import { str } from "@/lib/pure";
import { capabilityStart } from "@/lib/capability";
import { withHeadsUp } from "@/lib/capability-pure";
import { interruptedPatch } from "@/lib/completion-pure";

const COLS = "id, parent_id, project_id, agent, title, request, status, result, error, trace, pending, created_at, started_at, finished_at";

// Last stale-task sweep per user: the AGENTS station polls this every 3 s, the sweep only needs to run once a minute.
const swept = new Map<string, number>();

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  // Tasks left "running" by a server restart can never finish: mark them failed so they don't look stuck.
  if (Date.now() - (swept.get(user.id) ?? 0) > 60_000) {
    swept.set(user.id, Date.now());
    const { data: stale } = await sb.from("tasks").select("id, pending").eq("status", "running").lt("started_at", new Date(Date.now() - 20 * 60_000).toISOString());
    const resumable = await import("@/lib/bg-resume").then((m) => m.bgTurnIds()).catch(() => null); // a background CORE turn may run past 20 min
    if (resumable) for (const t of (stale ?? []).filter((x) => !resumable.has(x.id))) await sb.from("tasks").update(interruptedPatch(t.pending, "Interrupted (ORBIT restarted). Press Retry.")).eq("id", t.id).eq("status", "running");
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

  // Check before promising: refuse only when Claude Code is known down; anything else missing goes on the task as a heads-up.
  const cap = await capabilityStart(request, body.lang === "et" || body.lang === "en" ? body.lang : undefined);
  if (cap.block) return Response.json({ error: cap.block }, { status: 503 });
  const { data, error } = await sb.from("tasks").insert({ user_id: user.id, agent, project_id, ...withHeadsUp(title, request, cap.headsUp) }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  void kickQueue(sb, user.id);
  return Response.json({ task: data }, { status: 201 });
}
