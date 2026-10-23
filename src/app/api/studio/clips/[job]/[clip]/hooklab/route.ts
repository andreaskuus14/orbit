import { stat } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { getJob, inboxDir, isJobBusy, loadAnalysis, startClipQueue, withJobLock } from "@/lib/clips/factory";
import { hookLabView, startHookLab } from "@/lib/clips/hooklab";
import { isClipId, isInboxName, isJobId } from "@/lib/clips/pure";

// "🧪 Hook lab": POST renders three alternative openings (A cold open, B first spoken word, C new hook) as versions from the saved
// analysis; GET ranks the rendered ones. Nothing is published: the owner still picks and clicks publish.
type Ctx = { params: Promise<{ job: string; clip: string }> };

async function ids(ctx: Ctx) {
  const { job, clip } = await ctx.params;
  return isJobId(job) && isClipId(clip) ? { job, clip } : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { res } = await requireUser();
  if (res) return res;
  const p = await ids(ctx);
  if (!p) return Response.json({ error: "Invalid id" }, { status: 400 });
  const [job, a] = await Promise.all([getJob(p.job), loadAnalysis(p.job)]);
  if (!job?.clips.some((c) => c.id === p.clip)) return Response.json({ error: "Clip not found" }, { status: 404 });
  if (!a) return Response.json({ error: "This job has no saved analysis" }, { status: 409 });
  return Response.json(await hookLabView(job, p.clip, a));
}

export async function POST(_req: Request, ctx: Ctx) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const p = await ids(ctx);
  if (!p) return Response.json({ error: "Invalid id" }, { status: 400 });
  return withJobLock(async () => {
    const job = await getJob(p.job), clip = job?.clips.find((c) => c.id === p.clip);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (isJobBusy(job)) return Response.json({ error: "Wait for the job to finish" }, { status: 409 });
    if (clip.status !== "ready" && clip.status !== "approved") return Response.json({ error: "Only ready or approved clips can go to the hook lab" }, { status: 409 });
    const a = await loadAnalysis(job.id);
    if (!a) return Response.json({ error: "This job has no saved analysis (made before versions existed): make clips from the video again" }, { status: 409 });
    if (!isInboxName(job.source) || !(await stat(path.join(inboxDir(), job.source)).catch(() => null))?.isFile()) return Response.json({ error: `${job.source} is no longer in the inbox` }, { status: 409 });
    const out = await startHookLab(job, clip, a);
    if (typeof out === "string") return Response.json({ error: out }, { status: 409 });
    return Response.json({ clips: out }, { status: 202 });
  });
}
