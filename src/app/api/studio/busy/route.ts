import { isJobBusy, isPublishing, listDownloads, listJobs } from "@/lib/clips/factory";
import { scoutView } from "@/lib/clips/scout";
import { allKeywords, localDay } from "@/lib/clips/scout-pure";
import { loopbackOrigin } from "@/lib/yt-analytics-pure";

export const dynamic = "force-dynamic";

// Auth-free, booleans only: scripts/night/orbit-night.ps1 polls it to know when the PC may go back to sleep.
// Host check: the server only listens on 127.0.0.1; this also refuses DNS-rebinding requests from web pages.
export async function GET(req: Request) {
  if (!loopbackOrigin(req.headers.get("host"))) return Response.json({ error: "localhost only" }, { status: 403 });
  try {
    const [jobs, downloads, v] = await Promise.all([listJobs(), listDownloads(), scoutView()]);
    const s = v.scout, now = new Date();
    const clips = jobs.some((j) => isJobBusy(j) || j.clips.some((c) => c.status === "rendering")); // incl. new versions of a done job
    const dl = downloads.some((d) => d.status === "queued" || d.status === "downloading");
    // Today's scheduled run hasn't happened yet and is at most 4 h away (the night run's limit), so it's worth staying awake for.
    const scoutPending = v.configured && (s.watchlist.length > 0 || allKeywords(s).length > 0) && s.lastScheduled !== localDay(now) && now.getHours() >= s.runAt - 4; // keywords as scoutDue counts them (AI ones too)
    const busy = clips || dl || v.running || isPublishing() || scoutPending;
    return Response.json({ busy, clips, downloads: dl, scout: v.running, publishing: isPublishing(), scoutPending });
  } catch {
    return Response.json({ error: "state unreadable" }, { status: 503 });
  }
}
