import { stat } from "node:fs/promises";
import { requireUser } from "@/lib/supabase/server";
import { clipFile, getJob, isPublishing, publishingKey, saveJob, startClipQueue, startPublish, withJobLock } from "@/lib/clips/factory";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { freeSlots } from "@/lib/clips/publish-schedule";
import { cleanOriginal, originalityIssue } from "@/lib/clips/publish-checks-pure";
import { YT_UPLOAD_SCOPE, hasScopes, videoResource } from "@/lib/yt-analytics-pure";
import { readStored } from "@/lib/yt-oauth";
import { allows } from "@/lib/autonomy";

// Uploads an approved clip to the connected YouTube channel in the background; progress/result land on clip.publish.
export async function POST(req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job: jobId, clip: clipId } = await params;
  if (!isJobId(jobId) || !isClipId(clipId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const { force = false, original: rawOriginal, ...meta } = b;
  if (typeof force !== "boolean") return Response.json({ error: "force must be a boolean" }, { status: 400 });
  const original = cleanOriginal(rawOriginal);
  if (original === null) return Response.json({ error: "original must be text of at most 200 characters" }, { status: 400 });
  const off = allows("studio-publish", "owner"); // Profile → Autonomy: Off refuses even his click
  if (!off.ok) return Response.json({ error: off.why }, { status: 409 });
  const s = await readStored();
  if (!s) return Response.json({ error: "Connect YouTube first" }, { status: 409 });
  if (!hasScopes(s.scope, [YT_UPLOAD_SCOPE])) return Response.json({ error: "Reconnect YouTube to allow uploads" }, { status: 403 });
  return withJobLock(async () => {
    const job = await getJob(jobId);
    const clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (clip.status !== "approved") return Response.json({ error: "Only approved clips can be published" }, { status: 409 });
    if (original !== undefined && original !== clip.original) { clip.original = original || undefined; await saveJob(job); } // kept even if the upload is refused
    const notOriginal = originalityIssue(job, clip);
    if (notOriginal) return Response.json({ error: notOriginal, clip }, { status: 409 });
    const file = clipFile(clip);
    if (!file || !(await stat(file).catch(() => null))?.isFile()) return Response.json({ error: "The clip's video file is missing" }, { status: 409 });
    const st = clip.publish?.status, mine = publishingKey() === `${jobId}/${clipId}`;
    // "uploading" with nothing running = the final save failed (S.pub is only set under this lock), so the video may be on YouTube:
    // like "unknown", it must be checked (Check YouTube) before a retry. force = the owner explicitly uploads again anyway.
    if (st === "uploading" && !mine) {
      clip.publish = { ...clip.publish!, status: "unknown", error: "Outcome unknown — check YouTube", at: new Date().toISOString() };
      await saveJob(job);
    }
    if (clip.publish?.status === "unknown" && !force) return Response.json({ error: "The last upload's outcome is unknown — check YouTube first", clip }, { status: 409 });
    if ((st === "done" || st === "scheduled" || (st === "uploading" && mine)) && !force) return Response.json({ error: st === "uploading" ? "Already uploading" : st === "done" ? "Already published" : "Already scheduled" }, { status: 409 });
    if (isPublishing()) return Response.json({ error: "Another clip is uploading — try again when it's done" }, { status: 409 });
    if (meta.publishAt === "next") { // "Next best slot": picked here, under the lock, so two clips can't get the same one
      [meta.publishAt] = await freeSlots();
      if (!meta.publishAt) return Response.json({ error: "No free slot in the next 6 months — edit your slots" }, { status: 409 });
    }
    const video = videoResource(meta, clip);
    if (typeof video === "string") return Response.json({ error: video }, { status: 400 });
    try { await startPublish(job, clip, file, video); } catch (e) { return Response.json({ error: (e as Error).message, clip }, { status: 409 }); } // approval gate / retry consent
    return Response.json({ clip }, { status: 202 });
  });
}
