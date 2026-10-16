import { readFile } from "node:fs/promises";
import path from "node:path";
import { api } from "./youtube";
import { parseCreatorInput } from "./youtube-pure";
import { saveState, studioRoot } from "./clips/factory";
import { ScoutError, lookupChannel, updateScout, type Call } from "./clips/scout";
import { DAILY_UNITS, charge, usedToday } from "./clips/scout-pure";
import { isPageToken, pickVideos, plan, planTopic, planWatch, pruneCache, sortVideos, topicQuery, unitCost, type Sort, type WatchVideo } from "./watch-pure";

// THEATER feeds, counted in the scout's daily YouTube budget:
//  creator  = their uploads playlist, 50 per page (2-3 units); "viral" = the last 50 sorted by views (no more pages)
//  topic    = search.list + videos.list (101 units a page); "viral" = most viewed of the last 7 days, "new" = newest
//  trending = YouTube's Gaming chart (1 unit a page)
// Channel ids are remembered in <studio>/watch-channels.json; pages are cached in memory (10 min, topics 30 min).

export type Feed = { videos: WatchVideo[]; next?: string; channel?: { id: string; title: string }; topic?: string; note?: string; unitsLeft?: number };
export type FeedQuery = { creator?: string | null; topic?: string | null; trending?: boolean; shorts: boolean; sort: Sort; page?: string; region?: string; fallback?: boolean };
type Cached = Map<string, { at: number; data: Feed }>;
const g = globalThis as unknown as { __orbitWatch?: Cached; __orbitTopics?: Cached; __orbitUnits?: { units?: number } };
const cache = (g.__orbitWatch ??= new Map()), topicCache = (g.__orbitTopics ??= new Map());
const left = (g.__orbitUnits ??= {}); // units left after the last metered call (shown next to "Load more")
const mapFile = () => path.join(studioRoot(), "watch-channels.json");
type Ids = Record<string, { id: string; title: string }>;
const readIds = (): Promise<Ids> => readFile(mapFile(), "utf8").then((t) => JSON.parse(t) as Ids).catch(() => ({}));
type Page<T = unknown> = { items?: T[]; nextPageToken?: unknown };
const next = (p: Page<unknown>) => (isPageToken(p.nextPageToken) ? p.nextPageToken : undefined);
const VIDEO_PARTS = "snippet,contentDetails,statistics";

function cached(c: Cached, key: string, ttl: number): Feed | undefined {
  const hit = c.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.data : undefined;
}
function remember(c: Cached, key: string, ttl: number, data: Feed): Feed {
  pruneCache(c, Date.now(), ttl);
  c.set(key, { at: Date.now(), data });
  return data;
}

export async function creatorFeed(creator: unknown, shorts: boolean, sort: Sort, page?: string): Promise<Feed> {
  const raw = typeof creator === "string" ? creator.trim().replace(/^@/, "").replace(/\s+/g, "") : "";
  const who = raw.length <= 40 ? parseCreatorInput(raw) : null;
  if (!who || "video" in who) throw new ScoutError("Say the creator's channel name, like “show me Jynxzi's latest videos”");
  const key = raw.toLowerCase(), pg = sort === "new" ? page : undefined; // "viral" is one page: the last 50 by views
  const ck = `${key}|${shorts}|${sort}|${pg ?? ""}`;
  const hit = cached(cache, ck, 10 * 60_000);
  if (hit) return hit;
  const apiKey = needKey();

  const ids = await readIds();
  let ch = Object.hasOwn(ids, key) ? ids[key] : undefined;
  return metered((l) => planWatch(!!ch, l), apiKey, async (call) => {
    if (!ch) {
      const c = await lookupChannel(who, call);
      if (!c?.id) throw new ScoutError(`YouTube has no channel called @${raw}; try the exact @handle from their channel page`, 404);
      ch = { id: c.id, title: c.snippet?.title ?? raw };
      ids[key] = ch;
      await saveState("watch-channels", mapFile(), ids).catch(() => {}); // only a cache
    }
    // uploads playlist = channel id with UC → UU; 50 a page is still 1 unit, and leaves enough after Shorts are filtered out
    const pl = await call<Page<{ contentDetails?: { videoId?: string } }>>("playlistItems",
      { part: "contentDetails", playlistId: `UU${ch.id.slice(2)}`, maxResults: "50", ...(pg ? { pageToken: pg } : {}) })
      .catch((e: Error) => { if (/^YouTube API 404/.test(e.message)) return { items: [] }; throw e; }); // no uploads yet
    const vids = (pl.items ?? []).map((i) => i.contentDetails?.videoId ?? "").filter(Boolean);
    const vs: Page = vids.length ? await call<Page>("videos", { part: VIDEO_PARTS, id: vids.join(",") }) : { items: [] };
    const videos = sortVideos(pickVideos(vs.items, shorts).map((v) => ({ ...v, channel: v.channel || ch?.title })), sort);
    return remember(cache, ck, 10 * 60_000, { channel: ch, videos, next: sort === "new" ? next(pl) : undefined });
  });
}

function needKey() {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new ScoutError("Add YOUTUBE_API_KEY to .env.local first", 503);
  return apiKey;
}

/** Runs `work` inside the scout's daily YouTube budget: reserves plan(unitsLeft) up front (check + charge in one locked step,
 *  so parallel lookups can't overshoot), counts each call at Google's price, and refunds what wasn't used. */
async function metered<T>(plan: (unitsLeft: number) => number | string, apiKey: string, work: (call: Call) => Promise<T>): Promise<T> {
  let before = 0;
  const reserved = await updateScout((x) => {
    before = DAILY_UNITS - usedToday(x.quota, new Date());
    const p = plan(before);
    if (typeof p === "string") throw new ScoutError(p, 429);
    x.quota = charge(x.quota, p, new Date());
    return p;
  });
  let units = 0;
  const call: Call = (p, params) => { units += unitCost(p); return api(p, params, apiKey); }; // Google bills failed calls too
  try { return await work(call); } finally {
    if (units < reserved) await updateScout((x) => { x.quota = charge(x.quota, units - reserved, new Date()); x.quota.used = Math.max(0, x.quota.used); }).catch(() => {});
    left.units = Math.max(0, before - units);
  }
}

/** "cs2" → videos about Counter-Strike 2: "viral" = most viewed of the last 7 days, "new" = newest. 101 units a page; cached 30 min. */
export async function topicFeed(topic: unknown, shorts: boolean, sort: Sort, page?: string, region?: string): Promise<Feed> {
  const q = topicQuery(topic);
  if (!q) throw new ScoutError("Say a topic of 1-60 characters, like “cs2” or “minecraft”");
  const ck = `${q.toLowerCase()}|${shorts}|${sort}|${page ?? ""}|${region ?? ""}`;
  const hit = cached(topicCache, ck, 30 * 60_000);
  if (hit) return hit;
  return metered(planTopic, needKey(), async (call) => {
    // 25 results cost the same 100 units as 12, and leave enough after Shorts / live streams are filtered out
    const found = await call<Page<{ id?: { videoId?: string } }>>("search", {
      part: "snippet", type: "video", q, maxResults: "25", safeSearch: "moderate",
      ...(sort === "viral" ? { order: "viewCount", publishedAfter: new Date(Date.now() - 7 * 86_400_000).toISOString() } : { order: "date", relevanceLanguage: "en" }),
      ...(shorts ? { videoDuration: "short" } : {}), ...(region ? { regionCode: region } : {}), ...(page ? { pageToken: page } : {}) });
    const ids = (found.items ?? []).map((i) => i.id?.videoId ?? "").filter(Boolean);
    const vs: Page = ids.length ? await call<Page>("videos", { part: VIDEO_PARTS, id: ids.join(",") }) : { items: [] };
    return remember(topicCache, ck, 30 * 60_000, { topic: q, videos: sortVideos(pickVideos(vs.items, shorts, false), sort), next: next(found) });
  });
}

/** YouTube's most popular Gaming videos right now: 1 unit a page of 24. */
export async function trendingFeed(page?: string, region?: string): Promise<Feed> {
  const ck = `trending|${page ?? ""}|${region ?? ""}`;
  const hit = cached(cache, ck, 10 * 60_000);
  if (hit) return hit;
  return metered((l) => plan(unitCost("videos"), l), needKey(), async (call) => {
    const vs = await call<Page>("videos", { part: VIDEO_PARTS, chart: "mostPopular", videoCategoryId: "20", maxResults: "24",
      ...(region ? { regionCode: region } : {}), ...(page ? { pageToken: page } : {}) });
    return remember(cache, ck, 10 * 60_000, { topic: "Trending Gaming", videos: pickVideos(vs.items, false), next: next(vs) });
  });
}

/** GET /api/theater. With `fallback` (only the typed/spoken Find asks; never "All", whose 4 lookups could otherwise cost
 *  4 × 101 units), a creator YouTube doesn't know (404 only) becomes a topic search for the same words. */
export async function theater(f: FeedQuery): Promise<Feed> {
  const out = async (): Promise<Feed> => {
    if (f.trending) return trendingFeed(f.page, f.region);
    if (f.topic != null) return topicFeed(f.topic, f.shorts, f.sort, f.page, f.region);
    try { return await creatorFeed(f.creator, f.shorts, f.sort, f.page); } catch (e) {
      if (!f.fallback || f.page || !(e instanceof ScoutError && e.status === 404) || !f.creator?.trim()) throw e; // 400 = bad input: shown as is
      const name = f.creator.trim().replace(/^@/, "");
      const r = await topicFeed(name, f.shorts, f.sort, undefined, f.region);
      return { ...r, note: `No channel @${name.replace(/\s+/g, "")} — showing videos about “${r.topic}”` };
    }
  };
  return { ...(await out()), unitsLeft: left.units };
}
