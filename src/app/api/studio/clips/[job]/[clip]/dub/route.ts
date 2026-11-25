import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { startClipQueue } from "@/lib/clips/factory";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { startDub } from "@/lib/clips/dub";

// Bilingual dub of an approved Short: a new version in the other language (English ↔ Estonian), in his own voice (dub-pure.ts).
// It lands in the review queue; nothing is published. No body.
async function POST_(_req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job, clip } = await params;
  if (!isJobId(job) || !isClipId(clip)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const r = await startDub(job, clip);
  if (typeof r === "string") return Response.json({ error: r }, { status: r === "Short not found" ? 404 : 409 });
  return Response.json({ clip: r }, { status: 202 });
}
export const POST = guard("studio/clips/[job]/[clip]/dub", POST_);
