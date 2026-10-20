import { meterYoutube, withYoutubeBudget } from "./youtube-quota";
import {
  OAUTH_ENV, fillDays, isVideoId, parseTable, periods, reportUrl, totalsFrom, trafficLabel,
  type Analytics, type RangeDays, type ReportQuery, type Row,
} from "./yt-analytics-pure";
import { OAuthError, getAccessToken, invalidateAccess, oauthEnv, readStored, wasExpired, type Stored } from "./yt-oauth";

// STUDIO analytics: real channel stats from the YouTube Analytics v2 API (owner's OAuth grant, read-only scopes).

const METRICS = "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares";

const g = globalThis as unknown as { __orbitYtaCache?: Map<string, { at: number; ttl: number; data: Analytics }> };
const cache = (g.__orbitYtaCache ??= new Map());

async function report(s: Stored, q: ReportQuery, retried = false): Promise<Row[]> {
  const token = await getAccessToken(s);
  let res: Response;
  try {
    meterYoutube("analytics");
    res = await fetch(reportUrl(q), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === "TimeoutError" ? "timed out" : "request failed");
  }
  if (res.status === 401 && !retried) { invalidateAccess(); return report(s, q, true); } // token revoked/rotated early
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${String(json?.error?.message ?? res.statusText).split(token).join("***").slice(0, 200)}`);
  return parseTable(json);
}

export function getAnalytics(options: { range: RangeDays; videoId?: string; force?: boolean }): Promise<Analytics> {
  return withYoutubeBudget("studio-analytics", "manual", () => analytics(options));
}
/** Cached 15 min per (connection, range, video); partial results only 1 min so a flaky query recovers soon. */
async function analytics({ range, videoId, force = false }: { range: RangeDays; videoId?: string; force?: boolean }): Promise<Analytics> {
  if (!oauthEnv()) return { connected: false, reason: "not_configured", setupEnv: OAUTH_ENV };
  if (videoId && !isVideoId(videoId)) throw new Error("Invalid video id");
  const s = await readStored();
  if (!s) return { connected: false, reason: wasExpired() ? "expired" : "not_connected" };
  const key = `${s.connectedAt}|${range}|${videoId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (force ? 30_000 : hit.ttl)) return hit.data; // Refresh still waits 30 s (API quota)

  // Refresh once up front so an expired grant is a clean "expired", not seven failed queries.
  try { await getAccessToken(s); } catch (e) {
    if (e instanceof OAuthError && e.message === "invalid_grant") return { connected: false, reason: "expired" };
    throw new Error(`Google sign-in failed (${e instanceof Error ? e.message : "unknown"})`);
  }

  const p = periods(range, new Date());
  const filters = videoId ? `video==${videoId}` : undefined;
  const q = (o: Omit<ReportQuery, "start" | "end">, prev = false) =>
    report(s, { start: prev ? p.prevStart : p.start, end: prev ? p.prevEnd : p.end, filters, ...o });
  const jobs = {
    daily: q({ dimensions: "day", metrics: METRICS, sort: "day" }),
    totals: q({ metrics: METRICS }),
    "previous totals": q({ metrics: METRICS }, true),
    // Own queries: if YouTube ever rejects engagedViews, only this KPI is missing (a warning), not the whole dashboard.
    "engaged views": q({ metrics: "engagedViews" }),
    "previous engaged views": q({ metrics: "engagedViews" }, true),
    traffic: q({ dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views" }),
    countries: q({ dimensions: "country", metrics: "views", sort: "-views", maxResults: 10 }),
    "top videos": videoId ? null : q({ dimensions: "video", metrics: "views,estimatedMinutesWatched,averageViewDuration", sort: "-views", maxResults: 10, filters: undefined }),
    retention: videoId ? q({ dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio,relativeRetentionPerformance" }) : null,
  };
  const names = Object.keys(jobs) as (keyof typeof jobs)[];
  const settled = await Promise.allSettled(names.map((k) => jobs[k]));
  const out = {} as Record<keyof typeof jobs, Row[] | undefined>;
  const warnings: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out[names[i]] = r.value ?? undefined;
    else warnings.push(`${names[i]}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
  });
  const failed = settled.filter((r) => r.status === "rejected").length;
  if (failed && failed === names.filter((k) => jobs[k]).length) throw new Error(`YouTube Analytics failed: ${warnings[0]}`);

  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const data: Analytics = {
    connected: true, channelTitle: s.channelTitle,
    range: { days: range, start: p.start, end: p.end },
    totals: totalsFrom(out.totals ?? out.daily ?? []), // daily sums are a fine stand-in if only the totals query failed
    prevTotals: totalsFrom(out["previous totals"] ?? []),
    daily: fillDays(out.daily ?? [], p.start, p.end),
    traffic: (out.traffic ?? []).map((r) => ({ source: String(r.insightTrafficSourceType), label: trafficLabel(String(r.insightTrafficSourceType)), views: num(r.views) })),
    countries: (out.countries ?? []).map((r) => ({ country: String(r.country), views: num(r.views) })),
    ...(videoId
      ? { retention: (out.retention ?? []).map((r) => ({ t: num(r.elapsedVideoTimeRatio), ratio: num(r.audienceWatchRatio), relative: num(r.relativeRetentionPerformance) })) }
      : { topVideos: (out["top videos"] ?? []).map((r) => ({ id: String(r.video), views: num(r.views), watchMinutes: num(r.estimatedMinutesWatched), avgViewSec: num(r.averageViewDuration) })) }),
    ...(out["engaged views"] && out["previous engaged views"] && {
      engaged: { cur: num(out["engaged views"][0]?.engagedViews), prev: num(out["previous engaged views"][0]?.engagedViews) } }),
    warnings, fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), ttl: warnings.length ? 60_000 : 15 * 60_000, data });
  return data;
}

/** One Analytics v2 report for the owner (retries once on 401). Used by the clip learning loop. */
export const getAnalyticsReport = (s: Stored, q: ReportQuery) => withYoutubeBudget("learning-analytics", "scout", () => report(s, q));
