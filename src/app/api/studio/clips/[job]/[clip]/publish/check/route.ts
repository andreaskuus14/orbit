import { requireUser } from "@/lib/supabase/server";
import { reconcilePublish, startClipQueue } from "@/lib/clips/factory";
import { isClipId, isJobId } from "@/lib/clips/pure";

// "Check YouTube": settles an upload whose outcome is unknown by looking for it among the channel's newest uploads. Never uploads.
export async function POST(_req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job: jobId, clip: clipId } = await params;
  if (!isJobId(jobId) || !isClipId(clipId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const clip = await reconcilePublish(jobId, clipId);
  if (!clip) return Response.json({ error: "Clip not found" }, { status: 404 });
  if (typeof clip === "string") return Response.json({ error: clip }, { status: 409 });
  return Response.json({ clip });
}
