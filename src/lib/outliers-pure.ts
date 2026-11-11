// CORE's find_outliers: videos that did far better than their own channel's normal (views / channel median of recent uploads).
// Pure scoring and formatting; the YouTube calls live in outliers.ts. Tests: tests/outliers-pure.test.ts.
import { fenceUntrusted } from "./reach/pure.ts";
import type { Idea } from "./ideas-pure.ts";
export type OutlierVideo = { id: string; title: string; channelId: string; channel: string; views: number; publishedAt: string };
export type Baseline = { median: number | null; n: number; lowConfidence: boolean };
export type Outlier = OutlierVideo & { median: number; score: number; lowConfidence: boolean; n: number };

export const MIN_AGE_MS = 48 * 3_600_000; // a fresh upload hasn't had time to get its views: it would drag the median down
export const MIN_SAMPLE = 5;

export type VideoItem = { id?: string; snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string }; statistics?: { viewCount?: string } };
/** A videos.list item → a scorable video; null without a view count (hidden ≠ 0) or when live/upcoming (premieres drag medians down). */
export function toVideo(v: VideoItem): OutlierVideo | null {
  const s = v.snippet, views = Number(v.statistics?.viewCount);
  if (!v.id || !s?.channelId || !s.publishedAt || (s.liveBroadcastContent ?? "none") !== "none" || v.statistics?.viewCount == null || !Number.isFinite(views)) return null;
  return { id: v.id, title: s.title ?? "", channelId: s.channelId, channel: s.channelTitle ?? "", views, publishedAt: s.publishedAt };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A channel's normal: the median views of its uploads older than 48 h; under 5 such uploads it's low-confidence. */
export function baseline(videos: OutlierVideo[], now: number): Baseline {
  const old = videos.filter((v) => now - Date.parse(v.publishedAt) >= MIN_AGE_MS).map((v) => v.views);
  return { median: median(old), n: old.length, lowConfidence: old.length < MIN_SAMPLE };
}

/** Each candidate scored against its own channel's recent uploads; highest first (ties: more views, then id). No baseline = left out. */
export function scoreOutliers(candidates: OutlierVideo[], uploadsByChannel: Map<string, OutlierVideo[]>, now: number, limit = 10): Outlier[] {
  const bases = new Map<string, Baseline>();
  const out: Outlier[] = [];
  for (const v of new Map(candidates.map((c) => [c.id, c])).values()) {
    let b = bases.get(v.channelId);
    if (!b) bases.set(v.channelId, b = baseline(uploadsByChannel.get(v.channelId) ?? [], now));
    if (!b.median) continue;
    out.push({ ...v, median: b.median, score: Math.round((v.views / b.median) * 10) / 10, lowConfidence: b.lowConfidence, n: b.n });
  }
  return out.sort((a, b) => b.score - a.score || b.views - a.views || a.id.localeCompare(b.id)).slice(0, limit);
}

export function ageText(publishedAt: string, now: number): string {
  const h = Math.max(0, (now - Date.parse(publishedAt)) / 3_600_000);
  if (h < 48) return `${Math.round(h)} h old`;
  const d = Math.round(h / 24);
  return d < 60 ? `${d} days old` : d < 730 ? `${Math.round(d / 30)} months old` : `${Math.round(d / 365)} years old`;
}

const n = (x: number) => Math.round(x).toLocaleString("en-US");
export function outlierLines(list: Outlier[], now: number): string {
  if (!list.length) return "No outliers found: no comparable uploads.";
  return list.map((v, i) => `${i + 1}. "${v.title}" — ${v.channel} · ${n(v.views)} views · channel median ${n(v.median)} · ${v.score.toFixed(1)}x · ${ageText(v.publishedAt, now)} · https://www.youtube.com/watch?v=${v.id}`
    + (v.lowConfidence ? ` (low confidence: only ${v.n} uploads older than 48 h)` : "")).join("\n");
}

/** The tool's success text: scored lines, fenced as third-party data (titles come from YouTube). */
export function outlierReport(label: string, candidates: OutlierVideo[], byChannel: Map<string, OutlierVideo[]>, now: number, limit: number): string {
  const body = candidates.length ? `${outlierLines(scoreOutliers(candidates, byChannel, now, limit), now)}\nScore = views / the channel's median views (uploads older than 48 h).` : "No outliers found: no videos to score.";
  return fenceUntrusted(label, body, 6000);
}

export type OutlierInput = { channel?: string; query?: string; limit: number };
export function parseOutlierInput(i: Record<string, unknown>): OutlierInput | { error: string } {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const channel = s(i.channel).slice(0, 200), query = s(i.query).slice(0, 100);
  if (!channel && !query) return { error: "Error: find_outliers needs \"channel\" (@handle, channel URL or UC… id) or \"query\" (search words)" };
  const raw = i.limit == null || i.limit === "" ? NaN : Number(i.limit);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(25, Math.floor(raw))) : 10;
  return { ...(channel ? { channel } : { query }), limit };
}

// ---- weekly run into IDEA RADAR (outliers.ts: maybeWeeklyOutliers) ----
export const OUTLIERS_EVERY_MS = 7 * 86_400_000;
export const OUTLIER_MIN_SCORE = 3; // views / channel median: under 3x is normal variation, not an idea
export const OUTLIER_QUERIES = 2; // 100 quota units a search: at most 2 a week
export const outliersDue = (lastAt: string | undefined, now: number) => !lastAt || !(now - Date.parse(lastAt) < OUTLIERS_EVERY_MS);
/** The owner's own scout keywords (his own words first, then the AI ones), trimmed, each once, capped. */
export const outlierQueries = (keywords: string[]) => [...new Set(keywords.map((k) => (typeof k === "string" ? k.trim().slice(0, 100) : "")).filter(Boolean))].slice(0, OUTLIER_QUERIES);

/** Strong, low-doubt outliers → IDEA RADAR ideas. A video already on the board is refreshed in place (id and dismissal kept). */
export function mergeOutlierIdeas(ideas: Idea[], found: { query: string; list: Outlier[] }[], now: string, makeId: () => string): { ideas: Idea[]; added: number } {
  const out = [...ideas];
  let added = 0;
  for (const { query, list } of found) for (const v of list) {
    if (v.score < OUTLIER_MIN_SCORE || v.lowConfidence) continue;
    const i = out.findIndex((x) => x.origin === "outliers" && x.video === v.id);
    const idea: Idea = { id: i >= 0 ? out[i].id : makeId(), origin: "outliers", video: v.id, videoTitle: v.title.slice(0, 120),
      title: `Outlier on "${query.slice(0, 60)}": ${v.score.toFixed(1)}x its channel's normal`.slice(0, 120),
      summary: `${v.channel} got ${Math.round(v.views).toLocaleString("en-US")} views, ${v.score.toFixed(1)}x the channel's median of ${Math.round(v.median).toLocaleString("en-US")}.`,
      area: "studio", score: Math.min(95, Math.round(50 + 10 * Math.log2(v.score))), next: "Watch why it worked (title, hook, topic) and test your own angle on it.",
      at: i >= 0 ? out[i].at : now, sourceAt: v.publishedAt, dismissed: i >= 0 ? out[i].dismissed : undefined };
    if (i >= 0) out[i] = idea; else { out.unshift(idea); added++; }
  }
  return { ideas: out, added };
}
