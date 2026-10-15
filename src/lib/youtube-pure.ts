// STUDIO: pure YouTube helpers (no server imports), shared by the API, the 3D world and tests.

export type Video = { id: string; title: string; publishedAt: string; views: number; likes: number; comments: number; durationSec: number; thumb: string };
export type Channel = { title: string; handle: string; subs: number; views: number; videoCount: number; thumb: string };

const DAY = 86_400_000;

/** Moon size: log-scaled by views so one viral video doesn't dwarf the rest. Always finite. */
export function moonRadius(views: number, maxViews: number, min = 0.12, max = 0.6) {
  if (!(maxViews > 0) || !(views > 0)) return min;
  const t = Math.log1p(views) / Math.log1p(maxViews);
  return min + (max - min) * Math.min(1, Math.max(0, t));
}

/** Views per day since publish; age floored at 1 day so a 1-hour-old video doesn't read as 24× its pace. */
export function viewsPerDay(v: Pick<Video, "views" | "publishedAt">, now: number) {
  const t = Date.parse(v.publishedAt);
  const age = Number.isFinite(t) ? Math.max(1, (now - t) / DAY) : 1;
  return Math.max(0, v.views || 0) / age;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median views/day of the channel's videos, optionally leaving one out. */
export function medianViewsPerDay(videos: Video[], now: number, exceptId?: string) {
  return median(videos.filter((v) => v.id !== exceptId).map((v) => viewsPerDay(v, now)));
}

/** "Comet alerts": videos from the last 14 days running at ≥3× the median pace of the channel's other videos. */
export function takeoff(videos: Video[], now: number, factor = 3): { id: string; ratio: number }[] {
  if (videos.length < 4) return []; // needs ≥3 other videos to compare against
  const out: { id: string; ratio: number }[] = [];
  for (const v of videos) {
    const t = Date.parse(v.publishedAt);
    if (!Number.isFinite(t) || now - t > 14 * DAY) continue;
    // Floor of 1 view/day so a dead channel's first trickle isn't a "comet" (and no division by 0).
    const ratio = viewsPerDay(v, now) / Math.max(1, medianViewsPerDay(videos, now, v.id));
    if (ratio >= factor) out.push({ id: v.id, ratio });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** "@handle", a "UC…" channel id, or a youtube.com/@handle or /channel/UC… URL. */
export function parseChannelInput(s: string | null | undefined): { handle: string } | { id: string } | null {
  const v = (s ?? "").trim();
  const url = v.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?:(@[\w.-]{3,30})|channel\/(UC[\w-]{22}))(?:[/?#]|$)/i);
  if (url) return url[1] ? { handle: url[1] } : { id: url[2] };
  if (/^@[\w.-]{3,30}$/.test(v)) return { handle: v };
  if (/^UC[\w-]{22}$/.test(v)) return { id: v };
  return null;
}

/** ISO 8601 duration ("PT1H2M3S", "P1DT5M") → seconds; 0 when unparseable. */
export function parseIsoDuration(s: string | null | undefined) {
  const m = (s ?? "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + Math.round(+(m[4] ?? 0));
}

export const isShort = (v: Pick<Video, "durationSec">) => v.durationSec > 0 && v.durationSec <= 60;
