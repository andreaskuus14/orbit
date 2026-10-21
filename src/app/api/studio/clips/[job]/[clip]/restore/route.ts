import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { restoreOriginal } from "@/lib/clips/flop-retry";

export async function POST(req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/studio/clips", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const { job, clip } = await params;
  if (!isJobId(job) || !isClipId(clip)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const b = await req.json().catch(() => null);
  if (typeof b?.videoId !== "string") return Response.json({ error: "Read the original video before restoring" }, { status: 400 });
  try { return Response.json({ clip: await restoreOriginal(job, clip, b.videoId) }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't restore the original" }, { status: 409 }); }
}
