import { requireUser } from "@/lib/supabase/server";
import { getJob, startClipQueue, updateClip, withJobLock } from "@/lib/clips/factory";
import { isClipId, isJobId } from "@/lib/clips/pure";

// Approve/reject a clip or rename it. Rejecting deletes its rendered files, so it can't be approved afterwards.
export async function PATCH(req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job: jobId, clip: clipId } = await params;
  if (!isJobId(jobId) || !isClipId(clipId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const { status, title } = b;
  if (status !== undefined && status !== "approved" && status !== "rejected") return Response.json({ error: "status must be approved or rejected" }, { status: 400 });
  if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 200)) return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
  return withJobLock(async () => {
    const job = await getJob(jobId);
    const clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (status && (clip.status === "rendering" || clip.status === "failed")) return Response.json({ error: `Clip is ${clip.status}` }, { status: 409 });
    if (status === "rejected" && clip.publish?.status === "uploading") return Response.json({ error: "Wait for the YouTube upload to finish" }, { status: 409 });
    if (status === "approved" && clip.status === "rejected") return Response.json({ error: "Rejected clips' files are deleted" }, { status: 409 });
    await updateClip(job, clip, { status, title: typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 70) : undefined });
    return Response.json({ clip });
  });
}
