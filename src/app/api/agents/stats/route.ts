import { requireUser } from "@/lib/supabase/server";
import { aggregateStats, safeZone, type TaskRow } from "@/lib/agent-stats-pure";

/** Per-agent stats over the last 30 days (top-level and delegated tasks). ?tz=Europe/Tallinn sets the local days of last7. */
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data, error } = await sb.from("tasks").select("agent, status, created_at, started_at, finished_at")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(aggregateStats((data ?? []) as TaskRow[], new Date(), safeZone(new URL(req.url).searchParams.get("tz"))));
}
