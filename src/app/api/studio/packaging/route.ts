import { requireUser } from "@/lib/supabase/server";
import { getStudio } from "@/lib/youtube";
import { getAnalyticsReport } from "@/lib/yt-analytics";
import { oauthEnv, readStored } from "@/lib/yt-oauth";
import { rankPackaging, type PackagingHistory } from "@/lib/packaging-pure";
import { packagingHistoryFrom } from "@/lib/clips/pipeline-pure";

export const dynamic = "force-dynamic";

// STUDIO packaging scorer (Pipeline board → thumbnail + title A/B). POST {titles: 2–5 strings, isShort?: boolean (default true)}
// ranks the titles against the owner's own CTR history (read-only YouTube Analytics, owner's OAuth grant). Without a connection it
// still answers with packaging-pure's starting priors and says why. Nothing is written to YouTube.

type Source = { connected: boolean; reason?: "not_configured" | "not_connected" | "no_channel" | "error"; message?: string };
const DAY = 86_400_000;
const g = globalThis as unknown as { __orbitPackHistory?: { key: string; at: number; ttl: number; history: PackagingHistory[]; source: Source } };

/** History cached 1 h per connection (5 min after an error), so scoring while typing costs no API quota. */
async function history(): Promise<{ history: PackagingHistory[]; source: Source }> {
  if (!oauthEnv()) return { history: [], source: { connected: false, reason: "not_configured" } };
  const s = await readStored();
  if (!s) return { history: [], source: { connected: false, reason: "not_connected" } };
  const hit = g.__orbitPackHistory;
  if (hit && hit.key === s.connectedAt && Date.now() - hit.at < hit.ttl) return hit;
  let out: { history: PackagingHistory[]; source: Source };
  try {
    const studio = await getStudio();
    if (!studio.configured) out = { history: [], source: { connected: true, reason: "no_channel", message: "Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL so ORBIT knows your video titles." } };
    else {
      const now = Date.now(), day = (t: number) => new Date(t).toISOString().slice(0, 10);
      // shortcut: thumbnail impression metrics are assumed available per video in Analytics v2; a rejection falls back to priors with the API's message.
      const rows = await getAnalyticsReport(s, { start: day(now - 365 * DAY), end: day(now), dimensions: "video", sort: "-videoThumbnailImpressions", maxResults: 200,
        metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate,averageViewPercentage" });
      out = { history: packagingHistoryFrom(rows, studio.videos), source: { connected: true } };
    }
  } catch (e) {
    out = { history: [], source: { connected: true, reason: "error", message: e instanceof Error ? e.message.slice(0, 200) : "YouTube Analytics failed" } };
  }
  g.__orbitPackHistory = { key: s.connectedAt, at: Date.now(), ttl: out.source.reason ? 5 * 60_000 : 60 * 60_000, ...out };
  return out;
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { titles?: unknown; isShort?: unknown } | null;
  const titles = Array.isArray(b?.titles) ? [...new Set(b.titles.filter((t): t is string => typeof t === "string").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))] : [];
  if (titles.length < 2 || titles.length > 5 || titles.some((t) => t.length > 100)) return Response.json({ error: "Give 2–5 different titles, each up to 100 characters" }, { status: 400 });
  const isShort = b?.isShort !== false;
  const h = await history();
  const ranked = rankPackaging(h.history, titles.map((title) => ({ title })), isShort);
  return Response.json({ ...h.source, samples: ranked[0]?.samples ?? 0, mode: ranked[0]?.mode ?? "prior", ranked: ranked.map(({ rank, title, predictedCtr, interval, reasons }) => ({ rank, title, predictedCtr, interval, reasons })) });
}
