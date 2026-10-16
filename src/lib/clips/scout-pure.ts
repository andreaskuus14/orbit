// Video Scout (pure, tested): settings validation, candidate filters, scoring, quota accounting, Claude-reply checks.
import { parseIsoDuration } from "../youtube-pure.ts";
import { isVideoId } from "../yt-analytics-pure.ts";
import { MAX_SOURCE_SEC } from "./pure.ts"; // the clip job's own limit

export type ScoutCreator = { channelId: string; title: string; autoClip: boolean };
// maxAgeHours: keyword searches; creatorMaxAgeDays: watchlist uploads (creators post every few days, not hourly)
export type ScoutSettings = { watchlist: ScoutCreator[]; keywords: string[]; maxAgeHours: number; creatorMaxAgeDays: number; minMinutes: number; dailyAuto: number; runAt: number };
export type ScoutStats = { views: number; likes: number; comments: number };
export type PickStatus = "new" | "queued" | "dismissed";
export type ScoutPick = { videoId: string; url: string; title: string; channel: string; channelId: string; durationSec: number; publishedAt: string;
  stats: ScoutStats; score: number; reason: string; source: "watchlist" | "keyword"; status: PickStatus; error?: string };
export type ScoutRun = { at: string; ok: boolean; error?: string; warnings: string[]; candidates: number; units: number; ranker: "claude" | "score"; auto: number;
  skipped?: Record<string, number>; summary?: string }; // why candidates were left out, and that as one line for the UI
export type Scout = ScoutSettings & {
  v: 2; picks: ScoutPick[]; seen: string[]; // seen: video ids dismissed or queued, never suggested again
  quota: { day: string; used: number }; // units spent on the Pacific-time day YouTube's quota resets on
  auto: { day: string; n: number }; // auto clip jobs started on this local day
  lastRun?: ScoutRun; lastScheduled?: string; // local day the scheduled run last happened (or failed)
  kwNext: number; // rotates keyword searches when there are more keywords than one run may search
};
/** A video as the filters/scorer see it (built from videos.list). */
export type Candidate = { id: string; title: string; channel: string; channelId: string; publishedAt: string; durationSec: number; live: string;
  description: string; stats: ScoutStats; source: "watchlist" | "keyword"; baseline?: number }; // baseline: the channel's median views/hour

export const DAILY_UNITS = 1500; // our own cap, well under the default 10,000/day so STUDIO stats and uploads keep working
export const SEARCH_UNITS = 100, MAX_SEARCHES = 3;
export { MAX_SOURCE_SEC };
export const DEFAULTS: ScoutSettings = { watchlist: [], keywords: [], maxAgeHours: 48, creatorMaxAgeDays: 7, minMinutes: 8, dailyAuto: 1, runAt: 6 };
const SEEN_MAX = 1000, PICKS_MAX = 10;

export const emptyScout = (): Scout => ({ v: 2, ...DEFAULTS, picks: [], seen: [], quota: { day: "", used: 0 }, auto: { day: "", n: 0 }, kwNext: 0 });

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
export const isChannelId = (s: unknown): s is string => typeof s === "string" && /^UC[\w-]{22}$/.test(s);
const isVid = (s: unknown): s is string => typeof s === "string" && isVideoId(s);

/** A settings patch checked against the current settings → the new settings, or a message for a 400. */
export function validSettings(b: Record<string, unknown>, cur: ScoutSettings): ScoutSettings | string {
  const out = { ...cur };
  if (b.watchlist !== undefined) {
    if (!Array.isArray(b.watchlist) || b.watchlist.length > 50) return "watchlist must be a list of at most 50 creators";
    const ids = new Set<string>();
    out.watchlist = [];
    for (const c of b.watchlist) {
      if (!isObj(c) || !isChannelId(c.channelId) || typeof c.autoClip !== "boolean") return "each creator needs a UC… channelId and autoClip true/false";
      if (ids.has(c.channelId)) continue;
      ids.add(c.channelId);
      out.watchlist.push({ channelId: c.channelId, title: line(c.title, 100) || c.channelId, autoClip: c.autoClip });
    }
  }
  if (b.keywords !== undefined) {
    if (!Array.isArray(b.keywords) || b.keywords.length > 20) return "keywords must be a list of at most 20";
    const kw = b.keywords.map((k) => line(k, 80));
    if (kw.some((k) => k.length < 2)) return "each keyword must be 2-80 characters";
    out.keywords = [...new Set(kw)];
  }
  if (b.creator !== undefined) { // one creator at a time, applied to the current list (a stale UI snapshot can't drop others)
    const c = b.creator;
    if (!isObj(c) || !isChannelId(c.channelId) || (c.remove !== true && typeof c.autoClip !== "boolean")) return "creator needs a channelId and autoClip true/false or remove: true";
    if (!out.watchlist.some((w) => w.channelId === c.channelId)) return "That creator isn't on the watchlist";
    out.watchlist = c.remove === true ? out.watchlist.filter((w) => w.channelId !== c.channelId)
      : out.watchlist.map((w) => (w.channelId === c.channelId ? { ...w, autoClip: c.autoClip as boolean } : w));
  }
  const nums: [keyof ScoutSettings, number, number][] = [["maxAgeHours", 1, 336], ["creatorMaxAgeDays", 1, 60], ["minMinutes", 1, 180], ["dailyAuto", 0, 5], ["runAt", 0, 23]];
  for (const [k, lo, hi] of nums) {
    if (b[k] === undefined) continue;
    if (!int(b[k], lo, hi)) return `${k} must be a whole number ${lo}-${hi}`;
    (out as Record<string, unknown>)[k] = b[k];
  }
  return out;
}

/** A link or @handle typed where search words belong. */
export const looksLikeChannel = (k: string) => /^@|:\/\/|^www\.|youtu\.be\/|youtube\.com\/|(twitch\.tv|kick\.com)\//i.test(k);

const PICK_STATUS: PickStatus[] = ["new", "queued", "dismissed"];
/** scout.json → a Scout, or why it's unusable (then it's quarantined). Bad picks are dropped rather than failing the whole file. */
export function parseScout(x: unknown): Scout | string {
  if (!isObj(x)) return "not an object";
  if (x.v !== 1 && x.v !== 2) return "unknown version";
  // v1 → v2: the min length default dropped from 15 to 8 min (many creator edits are 8-15 min); a value the owner changed is kept
  const s = validSettings(x.v === 1 && x.minMinutes === 15 ? { ...x, minMinutes: 8 } : x, DEFAULTS);
  if (typeof s === "string") return s;
  const base = emptyScout();
  const picks = (Array.isArray(x.picks) ? x.picks : []).filter((p): p is ScoutPick => isObj(p) && isVid(p.videoId) && typeof p.title === "string"
    && typeof p.score === "number" && PICK_STATUS.includes(p.status as PickStatus) && (p.source === "watchlist" || p.source === "keyword") && isObj(p.stats))
    .map((p) => ({ ...p, url: watchUrl(p.videoId) })); // never trust a stored url: it's downloaded and rendered as a link
  const quota = isObj(x.quota) && typeof x.quota.day === "string" && typeof x.quota.used === "number" ? { day: x.quota.day, used: x.quota.used } : base.quota;
  const auto = isObj(x.auto) && typeof x.auto.day === "string" && typeof x.auto.n === "number" ? { day: x.auto.day, n: x.auto.n } : base.auto;
  return { ...base, ...s, picks, quota, auto, seen: (Array.isArray(x.seen) ? x.seen : []).filter(isVid).slice(-SEEN_MAX),
    lastRun: isObj(x.lastRun) ? (x.lastRun as ScoutRun) : undefined, lastScheduled: typeof x.lastScheduled === "string" ? x.lastScheduled : undefined,
    kwNext: Number.isInteger(x.kwNext) ? (x.kwNext as number) : 0 };
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const remember = (seen: string[], id: string) => [...seen.filter((s) => s !== id), id].slice(-SEEN_MAX);

// ---- days & quota ----

/** The Data API quota resets at midnight Pacific time. */
export const quotaDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
/** This PC's local day, YYYY-MM-DD. */
export const localDay = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
export const usedToday = (q: Scout["quota"], now: Date) => (q.day === quotaDay(now) ? q.used : 0);
export const charge = (q: Scout["quota"], units: number, now: Date) => ({ day: quotaDay(now), used: usedToday(q, now) + units });

/** What a run may spend: watchlist reads always (cheap), then up to 3 keyword searches (100 units each) that fit in today's budget.
 *  Worst-case watchlist cost: 1 playlistItems per creator + 1 videos.list per 50 of their 25 latest uploads. */
export function planRun(s: Scout, now: Date): { keywords: string[]; kwNext: number } | string {
  const left = DAILY_UNITS - usedToday(s.quota, now);
  const watch = s.watchlist.length + Math.ceil((s.watchlist.length * 25) / 50);
  if (!s.watchlist.length && !s.keywords.length) return "Add a creator or a keyword first";
  if (left < watch + (s.watchlist.length ? 0 : SEARCH_UNITS + 1)) return `Today's scout budget is used up (${DAILY_UNITS - left}/${DAILY_UNITS} units); it resets at midnight Pacific time`;
  const n = Math.min(MAX_SEARCHES, s.keywords.length, Math.floor((left - watch) / (SEARCH_UNITS + 1))); // +1: the videos.list for its results
  const start = s.keywords.length ? s.kwNext % s.keywords.length : 0;
  const keywords = Array.from({ length: n }, (_, i) => s.keywords[(start + i) % s.keywords.length]);
  return { keywords, kwNext: s.keywords.length ? (start + n) % s.keywords.length : 0 };
}

/** The scheduled run is due once per local day, at or after runAt (a day missed while ORBIT was off runs at the next start). */
export const scoutDue = (s: Scout, now: Date) => now.getHours() >= s.runAt && s.lastScheduled !== localDay(now) && (s.watchlist.length > 0 || s.keywords.length > 0);

// ---- candidates ----

/** A YouTube watch/short/live/youtu.be link → its video id, else null. */
export function videoIdOf(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const id = u.hostname === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  return isVid(id) ? id : null;
}

type VideoItem = { id?: unknown; snippet?: { title?: unknown; channelTitle?: unknown; channelId?: unknown; publishedAt?: unknown; liveBroadcastContent?: unknown; description?: unknown };
  contentDetails?: { duration?: unknown }; statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown } };
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** videos.list items → candidates (malformed items dropped). */
export function toCandidates(items: unknown, source: Candidate["source"]): Candidate[] {
  return (Array.isArray(items) ? (items as VideoItem[]) : []).flatMap((v) => {
    const sn = v?.snippet, id = v?.id;
    if (!isVid(id) || !sn || typeof sn.publishedAt !== "string") return [];
    return [{ id, title: line(sn.title, 200), channel: line(sn.channelTitle, 100), channelId: typeof sn.channelId === "string" ? sn.channelId : "",
      publishedAt: sn.publishedAt, durationSec: parseIsoDuration(typeof v.contentDetails?.duration === "string" ? v.contentDetails.duration : ""),
      live: typeof sn.liveBroadcastContent === "string" ? sn.liveBroadcastContent : "none", description: line(sn.description, 300),
      stats: { views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) }, source }];
  });
}

const hoursSince = (iso: string, now: number) => (now - Date.parse(iso)) / 3_600_000;

/** Why a candidate is skipped, or "" to keep it. */
export function skipReason(c: Candidate, o: { now: number; maxAgeHours: number; creatorMaxAgeDays: number; minMinutes: number; seen: Set<string>; made: Set<string> }): string {
  if (o.made.has(c.id)) return "made";
  if (o.seen.has(c.id)) return "seen";
  if (c.live !== "none") return "live"; // live now or upcoming: no finished video to download yet
  if (!(c.durationSec >= o.minMinutes * 60)) return "short";
  if (c.durationSec > MAX_SOURCE_SEC) return "long";
  const h = hoursSince(c.publishedAt, o.now);
  if (!Number.isFinite(h) || h > (c.source === "watchlist" ? o.creatorMaxAgeDays * 24 : o.maxAgeHours)) return c.source === "watchlist" ? "oldCreator" : "old";
  return "";
}

/** "25 found · 0 picks — 14 too short (<15 min), 9 older than 48 h, 2 live": why the list is short. */
export function skipSummary(found: number, picks: number, skipped: Record<string, number>, s: Pick<ScoutSettings, "minMinutes" | "maxAgeHours" | "creatorMaxAgeDays">): string {
  const label: Record<string, string> = { short: `too short (<${s.minMinutes} min)`, long: `too long (>${MAX_SOURCE_SEC / 3600} h)`, old: `older than ${s.maxAgeHours} h`,
    oldCreator: `creator uploads older than ${s.creatorMaxAgeDays} d`, live: "live/upcoming", made: "already downloaded", seen: "dismissed or queued before" };
  const why = Object.entries(skipped).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${label[k] ?? k}`);
  return `${found} found · ${picks} pick${picks === 1 ? "" : "s"}${why.length ? ` — ${why.join(", ")}` : ""}`;
}

/** Median views/hour of a channel's videos (age floored at 1 h); 0 with fewer than 3. */
export function baselineVph(vs: Candidate[], now: number): number {
  const xs = vs.map((v) => v.stats.views / Math.max(1, hoursSince(v.publishedAt, now))).sort((a, b) => a - b);
  if (xs.length < 3) return 0;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** 0-100 from: pace (views/hour), pace vs the channel's usual, engagement (comments weigh more: people react to moments), length sweet spot. */
export function pureScore(c: Candidate, now: number): number {
  const vph = c.stats.views / Math.max(1, hoursSince(c.publishedAt, now));
  const pace = Math.min(1, Math.log10(1 + vph) / 4); // 10k views/hour = full marks
  const rel = c.baseline ? Math.min(1, Math.log2(1 + vph / c.baseline) / 3) : 0.4; // 7× usual = full marks; unknown = a bit below average
  const eng = Math.min(1, (c.stats.likes + 3 * c.stats.comments) / Math.max(1, c.stats.views) / 0.08);
  const min = c.durationSec / 60, len = min >= 20 && min <= 120 ? 1 : min < 20 ? 0.7 : 0.8;
  return Math.round(100 * (0.4 * pace + 0.25 * rel + 0.2 * eng + 0.15 * len));
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));
/** The reason shown when Claude didn't rank. */
export function pureReason(c: Candidate, now: number): string {
  const vph = c.stats.views / Math.max(1, hoursSince(c.publishedAt, now));
  return `${compact(vph)} views/hour${c.baseline ? `, ${(vph / c.baseline).toFixed(1)}× the channel's usual pace` : ""}, ${compact(c.stats.comments)} comments.`;
}

/** Prompt lines for Claude: untrusted text stripped of angle brackets so it can't close the <videos> tag. */
export function rankPrompt(cs: Candidate[], now: number): string {
  const clean = (s: string) => s.replace(/[<>]/g, "");
  return `Rank these ${cs.length} recent long videos by how many viral Shorts moments they likely contain.
<videos>
${cs.map((c) => `id=${c.id} | ${clean(c.title)} | channel: ${clean(c.channel)} | ${Math.round(c.durationSec / 60)} min | ${Math.round(hoursSince(c.publishedAt, now))} h old | ${c.stats.views} views, ${c.stats.likes} likes, ${c.stats.comments} comments${c.baseline ? ` | channel usually ${Math.round(c.baseline)} views/h` : ""}
  ${clean(c.description)}`).join("\n")}
</videos>`;
}

/** Strict check of Claude's ranking: a JSON array of {id, score 0-100, reason}; ids must be ones we sent, once each. Any bad entry → null (use the pure score). */
export function parseRanking(text: string, ids: Set<string>): { id: string; score: number; reason: string }[] | null {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  let raw: unknown;
  try { raw = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : null; } catch { return null; }
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: { id: string; score: number; reason: string }[] = [], got = new Set<string>();
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== "string" || !ids.has(r.id) || got.has(r.id)) return null;
    if (typeof r.score !== "number" || !(r.score >= 0 && r.score <= 100)) return null;
    const reason = line(r.reason, 240);
    if (!reason) return null;
    got.add(r.id);
    out.push({ id: r.id, score: Math.round(r.score), reason });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Final picks: Claude's ranking when valid, else the pure score; best first, at most 10. */
export function buildPicks(cs: Candidate[], ranking: ReturnType<typeof parseRanking>, now: number): ScoutPick[] {
  const by = new Map(cs.map((c) => [c.id, c]));
  const ranked = ranking
    ? ranking.map((r) => ({ c: by.get(r.id)!, score: r.score, reason: r.reason }))
    : cs.map((c) => ({ c, score: pureScore(c, now), reason: pureReason(c, now) })).sort((x, y) => y.score - x.score);
  return ranked.slice(0, PICKS_MAX).map(({ c, score, reason }) => ({
    videoId: c.id, url: watchUrl(c.id), title: c.title, channel: c.channel, channelId: c.channelId, durationSec: c.durationSec,
    publishedAt: c.publishedAt, stats: c.stats, score, reason, source: c.source, status: "new" as const,
  }));
}

/** Picks the scout may download on its own: only new watchlist finds from creators the owner marked autoClip (they allow clipping).
 *  Keyword discoveries never qualify: nobody approved those creators. */
export function autoPicks(picks: ScoutPick[], watchlist: ScoutCreator[], slots: number): ScoutPick[] {
  const ok = new Set(watchlist.filter((w) => w.autoClip).map((w) => w.channelId));
  return picks.filter((p) => p.status === "new" && p.source === "watchlist" && ok.has(p.channelId)).sort((a, b) => b.score - a.score).slice(0, Math.max(0, slots));
}
