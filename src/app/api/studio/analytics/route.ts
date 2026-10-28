import { requireUser } from "@/lib/supabase/server";
import { getAnalytics } from "@/lib/yt-analytics";
import { isVideoId, parseRange } from "@/lib/yt-analytics-pure";
import { learnView } from "@/lib/clips/learn";
import { postmortemView } from "@/lib/clips/postmortem";
import { forecastView } from "@/lib/clips/forecast";

// STUDIO analytics: ?range=7|28|90|365 (default 28) &video=<11-char id> for one video. Contract: Analytics in yt-analytics-pure.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const sp = new URL(req.url).searchParams;
  if (sp.get("results") === "1") {
    try {
      const [i, postmortem] = await Promise.all([learnView(), postmortemView().catch(() => null)]);
      return Response.json({ shorts: i.lastShorts ?? [], checkedAt: i.checkedAt, warnings: i.warnings, postmortem });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Couldn't load Short results" }, { status: 502 });
    }
  }
  if (sp.get("forecast") === "1") {
    try { return Response.json(await forecastView()); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't load forecasts" }, { status: 502 }); }
  }
  const range = parseRange(sp.get("range")), video = sp.get("video") || undefined;
  if (!range) return Response.json({ error: "range must be 7, 28, 90 or 365" }, { status: 400 });
  if (video && !isVideoId(video)) return Response.json({ error: "Invalid video id" }, { status: 400 });
  try {
    return Response.json(await getAnalytics({ range, videoId: video, force: sp.get("refresh") === "1" }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't load analytics" }, { status: 502 });
  }
}
