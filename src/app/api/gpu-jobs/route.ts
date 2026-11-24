import { requireUser } from "@/lib/supabase/server";
import { cancelJob, listJobs } from "@/lib/gpu-queue";
import { jobProgress, queueOn } from "@/lib/gpu-queue-pure";

// GPU job queue (ORBIT_GPU_QUEUE=1, docs/gpu-queue.md). RLS limits every read and write to his own rows.
//   GET ?lang=en|et          → { on, jobs: Progress[] } (newest 20)
//   POST json {id, action:"cancel"} → { ok }
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const on = queueOn(process.env);
  if (!on) return Response.json({ on, jobs: [] });
  const lang = new URL(req.url).searchParams.get("lang") === "et" ? "et" : "en";
  const now = Date.now();
  return Response.json({ on, jobs: (await listJobs(sb)).map((j) => jobProgress(j, lang, now)) });
}

export async function POST(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  if (!b || b.action !== "cancel" || typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return Response.json({ error: "Bad request" }, { status: 400 });
  return Response.json({ ok: await cancelJob(sb, b.id) });
}
