import { requireUser } from "@/lib/supabase/server";
import { startScheduler } from "@/lib/scheduler";

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  startScheduler(); // no-op if already running; picks up a secret key added after the server started
  const [briefings, articles, jobs] = await Promise.all([
    sb.from("briefings").select("id, kind, title, content, citations, article_count, created_at").order("created_at", { ascending: false }).limit(20),
    sb.from("articles").select("id, title, url, source, topic, published_at").order("published_at", { ascending: false, nullsFirst: false }).limit(40),
    sb.from("job_runs").select("status, detail, started_at, finished_at").eq("job", "pulse").order("started_at", { ascending: false }).limit(5),
  ]);
  const err = briefings.error || articles.error || jobs.error;
  if (err) return Response.json({ error: err.message }, { status: 500 });
  return Response.json({
    briefings: briefings.data, articles: articles.data, jobs: jobs.data,
    scheduled: !!process.env.SUPABASE_SECRET_KEY,
  });
}
