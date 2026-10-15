import { stat } from "node:fs/promises";
import { requireUser } from "@/lib/supabase/server";
import { clipFile, getJob, isPublishing, startClipQueue, startPublish, withJobLock } from "@/lib/clips/factory";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { YT_UPLOAD_SCOPE, hasScopes, videoResource } from "@/lib/yt-analytics-pure";
import { readStored } from "@/lib/yt-oauth";

// Uploads an approved clip to the connected YouTube channel in the background; progress/result land on clip.publish.
export async function POST(req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job: jobId, clip: clipId } = await params;
  if (!isJobId(jobId) || !isClipId(clipId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const { force = false, ...meta } = b;
  if (typeof force !== "boolean") return Response.json({ error: "force must be a boolean" }, { status: 400 });
  const s = await readStored();
  if (!s) return Response.json({ error: "Connect YouTube first" }, { status: 409 });
  if (!hasScopes(s.scope, [YT_UPLOAD_SCOPE])) return Response.json({ error: "Reconnect YouTube to allow uploads" }, { status: 403 });
  return withJobLock(async () => {
    const job = await getJob(jobId);
    const clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (clip.status !== "approved") return Response.json({ error: "Only approved clips can be published" }, { status: 409 });
    const file = clipFile(clip);
    if (!file || !(await stat(file).catch(() => null))?.isFile()) return Response.json({ error: "The clip's video file is missing" }, { status: 409 });
    const st = clip.publish?.status;
    // "uploading" with nothing running = a final save failed (S.pub is only set under this lock): let it be retried.
    if ((st === "done" || (st === "uploading" && isPublishing())) && !force) return Response.json({ error: st === "done" ? "Already published" : "Already uploading" }, { status: 409 });
    if (isPublishing()) return Response.json({ error: "Another clip is uploading — try again when it's done" }, { status: 409 });
    const video = videoResource(meta, clip);
    if (typeof video === "string") return Response.json({ error: video }, { status: 400 });
    await startPublish(job, clip, file, video);
    return Response.json({ clip }, { status: 202 });
  });
}
