import { stat } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { getJob, inboxDir, isJobBusy, loadAnalysis, startClipQueue, startVersion, withJobLock } from "@/lib/clips/factory";
import { isClipId, isInboxName, isJobId, validVersion } from "@/lib/clips/pure";

// "Another version" of a clip: re-rendered from the job's saved analysis (no transcription; Claude only with suggest: true for an
// untyped title/hook). Body: { layout?, camSide?, camSize?, captions?: "karaoke"|"classic"|"none", hook?, title?, start?, end? (±10 s nudges), jumpCuts?, zooms?, suggest? }.
export async function POST(req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job: jobId, clip: clipId } = await params;
  if (!isJobId(jobId) || !isClipId(clipId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const v = validVersion(b);
  if (typeof v === "string") return Response.json({ error: v }, { status: 400 });
  return withJobLock(async () => {
    const job = await getJob(jobId);
    const clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (isJobBusy(job)) return Response.json({ error: "Wait for the job to finish" }, { status: 409 });
    if (clip.status !== "ready" && clip.status !== "approved") return Response.json({ error: "Only ready or approved clips can get another version" }, { status: 409 });
    const a = await loadAnalysis(jobId);
    if (!a) return Response.json({ error: "This job has no saved analysis (made before versions existed): make clips from the video again" }, { status: 409 });
    if (!isInboxName(job.source) || !(await stat(path.join(inboxDir(), job.source)).catch(() => null))?.isFile()) return Response.json({ error: `${job.source} is no longer in the inbox` }, { status: 409 });
    const next = await startVersion(job, clip, v, a);
    if (typeof next === "string") return Response.json({ error: next }, { status: 409 });
    return Response.json({ clip: next }, { status: 202 });
  });
}
