// Trend Radar, "Blowing up in your niche": recent Shorts from niche searches → views per hour since upload, outliers flagged. Pure; tested in tests/yt-viral.test.ts.

export type Viral = { id: string; title: string; channel: string; views: number; ageHours: number; viewsPerHour: number; hot: boolean };

const H = 3600_000;
export const VIRAL_MAX_QUERIES = 3, VIRAL_SEARCH_UNITS = 100, VIRAL_CACHE_MS = 3 * H, VIRAL_WINDOW_MS = 48 * H;
export const HOT_X = 3, HOT_MIN_VPH = 2_000; // "far above the rest": ≥ 3× the batch's median views/hour and a real audience
const ID = /^[\w-]{11}$/;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const line = (v: unknown, max: number) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The Shorts link, or null for anything that isn't a plain 11-char video id. */
export const shortsUrl = (id: string) => (ID.test(id) ? `https://www.youtube.com/shorts/${id}` : null);

/** Up to max search terms: the winners' creators first (proven), then the scout's creators and keywords. Case/spacing duplicates dropped. */
export function nicheQueries(winners: string[], creators: string[], keywords: string[], max = VIRAL_MAX_QUERIES): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of [...winners, ...creators, ...keywords]) {
    const q = line(raw, 60), k = q.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!k || k === "unknown" || seen.has(k)) continue;
    seen.add(k); out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

/** search.list JSON(s) → unique video ids. */
export function searchIds(...jsons: unknown[]): string[] {
  const ids = jsons.flatMap((j) => { const it = (j as { items?: unknown })?.items; return Array.isArray(it) ? it : []; })
    .map((x) => (x as { id?: { videoId?: unknown } })?.id?.videoId).filter((id): id is string => typeof id === "string" && ID.test(id));
  return [...new Set(ids)];
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/** videos.list JSON → Shorts uploaded in the last 48 h, fastest first, outliers flagged hot. */
export function parseViral(j: unknown, now: number, limit = 10): Viral[] {
  const items = (j as { items?: unknown })?.items;
  const vs = (Array.isArray(items) ? items : []).flatMap((v: { id?: unknown; snippet?: { title?: unknown; channelTitle?: unknown; publishedAt?: unknown }; statistics?: { viewCount?: unknown } }) => {
    const pub = Date.parse(String(v?.snippet?.publishedAt ?? ""));
    if (typeof v?.id !== "string" || !ID.test(v.id) || !Number.isFinite(pub) || now - pub > VIRAL_WINDOW_MS) return [];
    const ageHours = Math.max(1, (now - pub) / H), views = n(v.statistics?.viewCount); // ≥ 1 h: a 5-minute-old upload isn't "100k/h"
    return [{ id: v.id, title: line(v.snippet?.title, 200), channel: line(v.snippet?.channelTitle, 100), views, ageHours: Math.round(ageHours * 10) / 10, viewsPerHour: Math.round(views / ageHours), hot: false }];
  });
  const med = median(vs.map((v) => v.viewsPerHour));
  for (const v of vs) v.hot = v.viewsPerHour >= HOT_MIN_VPH && v.viewsPerHour >= HOT_X * Math.max(1, med);
  return vs.sort((a, b) => b.viewsPerHour - a.viewsPerHour).slice(0, limit);
}
