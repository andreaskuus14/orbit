import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { decidePostmortem, postmortemView } from "@/lib/clips/postmortem";

export const dynamic = "force-dynamic";

// Retention post-mortems. GET: the saved ones + status. POST {videoId, action:"accept"|"dismiss"}: the owner's click on a proposed rule
// (accept adds it to the Study playbook; nothing is ever added or removed without this click). Logic: src/lib/clips/postmortem.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await postmortemView());
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/studio/clips/postmortem", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") }))
    return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.videoId !== "string" || !/^[\w-]{11}$/.test(b.videoId) || (b.action !== "accept" && b.action !== "dismiss"))
    return Response.json({ error: "videoId and action (accept or dismiss) are required" }, { status: 400 });
  try {
    if (!(await decidePostmortem(b.videoId, b.action))) return Response.json({ error: "No open rule proposal for this video" }, { status: 404 });
    return Response.json(await postmortemView());
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't save" }, { status: 500 }); }
}
