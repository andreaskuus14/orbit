import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// STUDIO analytics: pure helpers for the YouTube Analytics v2 API and the OAuth loopback flow (no server imports; tested).

export type Totals = { views: number; watchMinutes: number; avgViewSec: number; subsGained: number; subsLost: number; likes: number; comments: number; shares: number };
export type Analytics =
  | { connected: false; reason: "not_configured" | "not_connected" | "expired"; setupEnv?: string[] }
  | { connected: true; channelTitle: string; range: { days: number; start: string; end: string };
      totals: Totals; prevTotals: Totals;
      daily: { day: string; views: number; watchMinutes: number; subsGained: number; subsLost: number }[];
      traffic: { source: string; label: string; views: number }[];
      countries: { country: string; views: number }[];
      topVideos?: { id: string; views: number; watchMinutes: number; avgViewSec: number }[];
      retention?: { t: number; ratio: number; relative: number }[];
      warnings: string[]; fetchedAt: string };

export type RangeDays = 7 | 28 | 90 | 365;
export const RANGES: RangeDays[] = [7, 28, 90, 365];
export const parseRange = (s: string | null | undefined): RangeDays | null => (s == null || s === "" ? 28 : RANGES.find((r) => String(r) === s) ?? null);
export const isVideoId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s);

export const YT_SCOPES = ["https://www.googleapis.com/auth/yt-analytics.readonly", "https://www.googleapis.com/auth/youtube.readonly"];
export const YT_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** Whether a grant's space-separated `scope` string includes every needed scope. */
export const hasScopes = (granted: string | undefined, needed: string[]) => needed.every((s) => (granted ?? "").split(" ").includes(s));
export const OAUTH_ENV = ["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"];
export const OAUTH_COOKIE = "orbit_yt_oauth";
export const OAUTH_PATH = "/api/studio/oauth";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Current and equal-length previous period (inclusive YYYY-MM-DD), ending 2 days ago: Analytics data lags ~48h. */
export function periods(days: number, now: Date) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 2 * DAY;
  const start = end - (days - 1) * DAY, prevEnd = start - DAY;
  return { start: iso(start), end: iso(end), prevStart: iso(prevEnd - (days - 1) * DAY), prevEnd: iso(prevEnd) };
}

export type ReportQuery = { start: string; end: string; metrics: string; dimensions?: string; filters?: string; sort?: string; maxResults?: number };

export function reportUrl(q: ReportQuery) {
  const p = new URLSearchParams({ ids: "channel==MINE", startDate: q.start, endDate: q.end, metrics: q.metrics });
  if (q.dimensions) p.set("dimensions", q.dimensions);
  if (q.filters) p.set("filters", q.filters);
  if (q.sort) p.set("sort", q.sort);
  if (q.maxResults) p.set("maxResults", String(q.maxResults));
  return `https://youtubeanalytics.googleapis.com/v2/reports?${p}`;
}

export type Row = Record<string, string | number>;

/** The API's { columnHeaders: [{name}], rows: [[...]] } table → one object per row keyed by column name. */
export function parseTable(json: unknown): Row[] {
  const j = json as { columnHeaders?: { name: string }[]; rows?: unknown[][] } | null;
  const names = (j?.columnHeaders ?? []).map((h) => h.name);
  return (j?.rows ?? []).map((r) => Object.fromEntries(names.map((n, i) => [n, typeof r[i] === "number" ? r[i] : String(r[i] ?? "")])));
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);

/** Sums rows of the standard metrics; avg view duration is the views-weighted mean (it isn't additive). */
export function totalsFrom(rows: Row[]): Totals {
  const t: Totals = { views: 0, watchMinutes: 0, avgViewSec: 0, subsGained: 0, subsLost: 0, likes: 0, comments: 0, shares: 0 };
  let weighted = 0;
  for (const r of rows) {
    t.views += n(r.views); t.watchMinutes += n(r.estimatedMinutesWatched);
    t.subsGained += n(r.subscribersGained); t.subsLost += n(r.subscribersLost);
    t.likes += n(r.likes); t.comments += n(r.comments); t.shares += n(r.shares);
    weighted += n(r.averageViewDuration) * n(r.views);
  }
  t.avgViewSec = t.views ? Math.round(weighted / t.views) : 0;
  return t;
}

/** One entry per day from start to end (inclusive); days the API omitted are zeros. */
export function fillDays(rows: Row[], start: string, end: string) {
  const by = new Map(rows.map((r) => [String(r.day), r]));
  const out: { day: string; views: number; watchMinutes: number; subsGained: number; subsLost: number }[] = [];
  for (let t = Date.parse(start + "T00:00:00Z"), e = Date.parse(end + "T00:00:00Z"); t <= e; t += DAY) {
    const d = iso(t), r = by.get(d);
    out.push({ day: d, views: n(r?.views), watchMinutes: n(r?.estimatedMinutesWatched), subsGained: n(r?.subscribersGained), subsLost: n(r?.subscribersLost) });
  }
  return out;
}

const TRAFFIC: Record<string, string> = {
  YT_SEARCH: "YouTube search", SUGGESTED: "Suggested videos", RELATED_VIDEO: "Suggested videos", BROWSE: "Browse features",
  SHORTS: "Shorts feed", EXT_URL: "External", NO_LINK_OTHER: "Direct or unknown", NO_LINK_EMBEDDED: "Embedded players",
  PLAYLIST: "Playlists", YT_PLAYLIST_PAGE: "Playlist pages", CHANNEL: "Channel pages", YT_CHANNEL: "Channel pages",
  YT_OTHER_PAGE: "Other YouTube features", SUBSCRIBER: "Subscriptions feed", NOTIFICATION: "Notifications",
  END_SCREEN: "End screens", ANNOTATION: "Cards & annotations", CAMPAIGN_CARD: "Campaign cards", ADVERTISING: "YouTube ads",
  PROMOTED: "Promoted", HASHTAGS: "Hashtag pages", SOUND_PAGE: "Sound pages", LIVE_REDIRECT: "Live redirects",
  PRODUCT_PAGE: "Product pages", VIDEO_REMIXES: "Remixes", IMMERSIVE_LIVE: "Immersive live", SHORTS_CONTENT_LINKS: "Shorts links",
  RELATED_VIEWS: "Related views", YT_SEARCH_RELATED: "Search (related)",
};
/** Unknown future codes fall back to "Some_code" → "Some code" instead of breaking. */
export const trafficLabel = (code: string) =>
  TRAFFIC[code] ?? (code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " "));

// ---- OAuth (loopback + PKCE) ----

const LOOPBACK = new Set(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]);
/** http origin for the redirect_uri, only for the hosts ORBIT runs on (so the session cookie survives the round trip). */
export const loopbackOrigin = (host: string | null | undefined) => (host && LOOPBACK.has(host.toLowerCase()) ? `http://${host.toLowerCase()}` : null);

export const randomToken = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Constant-time string compare; hashing first equalizes lengths for timingSafeEqual. */
export function sameSecret(a: string, b: string) {
  if (!a || !b) return false;
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function authUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: [...YT_SCOPES, YT_UPLOAD_SCOPE].join(" "),
    access_type: "offline", prompt: "consent", state: o.state, code_challenge: o.challenge, code_challenge_method: "S256",
  })}`;
}

// ---- uploads (YouTube Data API v3 videos.insert) ----

export type Privacy = "private" | "unlisted" | "public";
const PRIVACY: Privacy[] = ["private", "unlisted", "public"];
export type VideoResource = {
  snippet: { title: string; description: string; categoryId: string };
  status: { privacyStatus: Privacy; selfDeclaredMadeForKids: false; publishAt?: string };
};

/** Publish request body + clip → the video resource to upload, or a message for a 400. A schedule must be private until publishAt. */
export function videoResource(b: Record<string, unknown>, clip: { title: string; hook: string }, now = Date.now()): VideoResource | string {
  const {
    title = clip.title.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100),
    description = `${clip.hook.replace(/[<>]/g, "")}\n\n#shorts`.trim(), privacy = "private", publishAt,
  } = b;
  const t = typeof title === "string" ? title.trim() : "";
  if (!t || t.length > 100 || /[<>]/.test(t)) return "title must be 1-100 characters without < or >";
  if (typeof description !== "string" || new TextEncoder().encode(description).length > 5000 || /[<>]/.test(description))
    return "description must be at most 5000 bytes without < or >";
  if (!PRIVACY.includes(privacy as Privacy)) return "privacy must be private, unlisted or public";
  let at: string | undefined;
  if (publishAt != null && publishAt !== "") {
    const ms = typeof publishAt === "string" ? Date.parse(publishAt) : NaN;
    if (!(ms > now) || ms > now + 183 * DAY) return "publishAt must be a future date within 6 months";
    at = new Date(ms).toISOString();
  }
  return { snippet: { title: t, description, categoryId: "24" }, status: { privacyStatus: at ? "private" : (privacy as Privacy), selfDeclaredMadeForKids: false, ...(at && { publishAt: at }) } };
}

/** A YouTube API error response → a message for the owner. Only reason codes are used, never Google's free text. */
export function uploadError(status: number, json: unknown): string {
  const e = (json as { error?: { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] } } | null)?.error;
  const reasons = [...(e?.errors ?? []), ...(e?.details ?? [])].map((r) => r?.reason).filter((r): r is string => typeof r === "string");
  const has = (...r: string[]) => reasons.some((x) => r.includes(x));
  if (has("quotaExceeded", "uploadLimitExceeded", "dailyLimitExceeded")) return "YouTube's daily upload limit is reached; try tomorrow";
  if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return "Reconnect YouTube to allow uploads";
  if (status === 401 || has("authError", "invalid_grant")) return "Reconnect YouTube";
  return `YouTube upload failed (${status}${reasons[0] ? ` ${reasons[0].slice(0, 40)}` : ""})`;
}
