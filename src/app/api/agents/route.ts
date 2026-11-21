import { requireUser } from "@/lib/supabase/server";
import { BUILTIN_AGENTS, TOOLS } from "@/lib/agents";
import { BUILTIN_ONLY_TOOLS } from "@/lib/agent-defs-pure";
import { slugify, str } from "@/lib/pure";
import { CHAIN_TITLE } from "@/lib/chains-pure";
import { capabilityState } from "@/lib/capability";
import { agentStat, countTasks, type TaskCount } from "@/lib/agent-counts-pure";
import { loadUsageTotals } from "@/lib/analytics-usage";
import { missingUsageRpc } from "@/lib/analytics-usage-pure";

type Sb = NonNullable<Awaited<ReturnType<typeof requireUser>>["sb"]>;
/** Grouped counts (migrations 0028 + 0014); the old full scan when ORBIT_AGENT_COUNTS=0 or before 0028 is applied. */
async function loadAgentCounts(sb: Sb, since: string): Promise<{ tasks: TaskCount[]; usage: Parameters<typeof agentStat>[2] } | { error: { message: string } }> {
  const scan = async () => {
    const [tasks, usage] = await Promise.all([
      sb.from("tasks").select("agent, status, title"),
      sb.from("usage").select("purpose, input_tokens, output_tokens").like("purpose", "agent.%").gte("created_at", since),
    ]);
    const error = tasks.error || usage.error;
    if (error) return { error };
    return { tasks: countTasks(tasks.data ?? [], CHAIN_TITLE), usage: (usage.data ?? []).map((u) => ({ ...u, calls: 1 })) };
  };
  if (process.env.ORBIT_AGENT_COUNTS === "0") return scan();
  const { data, error } = await sb.rpc("agent_task_counts");
  if (error) return missingUsageRpc(error) ? scan() : { error };
  try { return { tasks: (data ?? []) as TaskCount[], usage: await loadUsageTotals(sb, 30) }; }
  catch (e) { return { error: { message: e instanceof Error ? e.message : String(e) } }; }
}

/** All agents with live status, task history counts and token usage (last 30 days). */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [custom, counts] = await Promise.all([
    sb.from("agents").select("slug, name, role, instructions, tools, enabled, created_at").order("created_at"),
    loadAgentCounts(sb, since),
  ]);
  const err = custom.error || ("error" in counts ? counts.error : null);
  if (err) return Response.json({ error: err.message }, { status: 500 });
  const { tasks, usage } = counts as { tasks: TaskCount[]; usage: Parameters<typeof agentStat>[2] };
  const stats = (slug: string) => agentStat(slug, tasks, usage);
  const agents = [
    ...BUILTIN_AGENTS.map((a) => ({ ...a, enabled: true, stats: stats(a.slug) })),
    ...(custom.data ?? []).map((a) => ({ ...a, builtin: false, color: "#e879f9", stats: stats(a.slug) })),
  ];
  // AGT01: connections as configured (env/files only) and as available now (with the doctor's latest checks); null on error = unknown.
  const [configured, available] = await Promise.all([capabilityState([]).catch(() => null), capabilityState().catch(() => null)]);
  return Response.json({ agents, deps: { configured, available }, tools: Object.entries(TOOLS).filter(([k]) => k !== "delegate" && !BUILTIN_ONLY_TOOLS.includes(k)).map(([name, t]) => ({ name, description: t.description, approval: !!t.approval })) });
}

/** Create a custom agent with your own instructions and an allow-list of tools. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const name = str(body.name, 60, 1);
  const instructions = str(body.instructions, 8000, 10);
  if (!name || !instructions) return Response.json({ error: "Give the agent a name and instructions (10+ characters)" }, { status: 400 });
  const slug = slugify(name);
  if (slug.length < 2 || BUILTIN_AGENTS.some((a) => a.slug === slug)) return Response.json({ error: "Pick a different name" }, { status: 400 });
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter((t: unknown) => typeof t === "string" && t in TOOLS && t !== "delegate" && !BUILTIN_ONLY_TOOLS.includes(t));
  const { data, error } = await sb.from("agents").insert({ user_id: user.id, slug, name, role: str(body.role, 200) || "", instructions, tools }).select("slug").single();
  if (error) return Response.json({ error: error.code === "23505" ? "An agent with that name exists" : error.message }, { status: 400 });
  return Response.json({ agent: data }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return Response.json({ error: "Missing slug" }, { status: 400 });
  const { data, error } = await sb.from("agents").delete().eq("slug", slug).select("slug");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Only your own custom agents can be removed" }, { status: 404 });
  return Response.json({ ok: true });
}
