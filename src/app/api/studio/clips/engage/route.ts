import { requireUser } from "@/lib/supabase/server";
import { draftReplies, engageView, writeDescription } from "@/lib/clips/engage";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { isVideoId } from "@/lib/yt-analytics-pure";

export const dynamic = "force-dynamic";

const fail = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });

// Engagement helpers (read-only on YouTube). GET = comments inbox (?refresh=1 refetches when 30 min have passed).
// POST {videoId} = reply drafts; POST {job, clip} = description + hashtags. Logic: src/lib/clips/engage.ts.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await engageView(new URL(req.url).searchParams.get("refresh") === "1")); }
  catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null) as { videoId?: unknown; job?: unknown; clip?: unknown } | null;
  try {
    if (typeof b?.videoId === "string" && isVideoId(b.videoId)) return Response.json(await draftReplies(b.videoId, req.signal));
    if (isJobId(b?.job) && isClipId(b?.clip)) return Response.json({ description: await writeDescription(b.job, b.clip, req.signal) });
  } catch (e) { return fail(e, 502); }
  return Response.json({ error: "Send {videoId} or {job, clip}" }, { status: 400 });
}
