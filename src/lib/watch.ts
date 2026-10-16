import { readFile } from "node:fs/promises";
import path from "node:path";
import { api } from "./youtube";
import { parseCreatorInput } from "./youtube-pure";
import { saveState, studioRoot } from "./clips/factory";
import { ScoutError, lookupChannel, updateScout, type Call } from "./clips/scout";
import { DAILY_UNITS, charge, usedToday } from "./clips/scout-pure";
import { pickLatest, pickVideos, planTopic, planWatch, pruneCache, topicQuery, unitCost, type WatchVideo } from "./watch-pure";

// THEATER lookup: a spoken creator name → their newest uploads in 2-3 YouTube units (counted in the scout's daily budget).
// Channel ids are remembered in <studio>/watch-channels.json; results are cached 10 minutes.

export type WatchResult = { channel: { id: string; title: string }; videos: WatchVideo[] };
export type TopicResult = { topic: string; videos: WatchVideo[]; note?: string };
const mapFile = () => path.join(studioRoot(), "watch-channels.json");
const g = globalThis as unknown as { __orbitWatch?: Map<string, { at: number; data: WatchResult }> };
const cache = (g.__orbitWatch ??= new Map());

type Ids = Record<string, { id: string; title: string }>;
const readIds = (): Promise<Ids> => readFile(mapFile(), "utf8").then((t) => JSON.parse(t) as Ids).catch(() => ({}));

export async function latestVideos(creator: unknown, shorts: boolean): Promise<WatchResult> {
  const raw = typeof creator === "string" ? creator.trim().replace(/^@/, "").replace(/\s+/g, "") : "";
  const who = raw.length <= 40 ? parseCreatorInput(raw) : null;
  if (!who || "video" in who) throw new ScoutError("Say the creator's channel name, like “show me Jynxzi's latest videos”");
  const key = raw.toLowerCase(), ck = `${key}|${shorts}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  const apiKey = needKey();

  const ids = await readIds();
  let ch = Object.hasOwn(ids, key) ? ids[key] : undefined;
  return metered((left) => planWatch(!!ch, left), apiKey, async (call) => {
    if (!ch) {
      const c = await lookupChannel(who, call);
      if (!c?.id) throw new ScoutError(`YouTube has no channel called @${raw}; try the exact @handle from their channel page`, 404);
      ch = { id: c.id, title: c.snippet?.title ?? raw };
      ids[key] = ch;
      await saveState("watch-channels", mapFile(), ids).catch(() => {}); // only a cache
    }
    // uploads playlist = channel id with UC → UU; 25 so a burst of Shorts can't hide the long uploads (still 1 unit)
    const pl = await call<{ items?: { contentDetails?: { videoId?: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: `UU${ch.id.slice(2)}`, maxResults: "25" })
      .catch((e: Error) => { if (/^YouTube API 404/.test(e.message)) return { items: [] }; throw e; }); // no uploads yet
    const vids = (pl.items ?? []).map((i) => i.contentDetails?.videoId ?? "").filter(Boolean);
    const vs = vids.length ? await call<{ items?: unknown[] }>("videos", { part: "snippet,contentDetails,statistics", id: vids.join(",") }) : { items: [] };
    const data = { channel: ch, videos: pickLatest(vs.items, shorts) };
    pruneCache(cache, Date.now(), 10 * 60_000);
    cache.set(ck, { at: Date.now(), data });
    return data;
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
  const reserved = await updateScout((x) => {
    const p = plan(DAILY_UNITS - usedToday(x.quota, new Date()));
    if (typeof p === "string") throw new ScoutError(p, 429);
    x.quota = charge(x.quota, p, new Date());
    return p;
  });
  let units = 0;
  const call: Call = (p, params) => { units += unitCost(p); return api(p, params, apiKey); }; // Google bills failed calls too
  try { return await work(call); } finally {
    if (units < reserved) await updateScout((x) => { x.quota = charge(x.quota, units - reserved, new Date()); x.quota.used = Math.max(0, x.quota.used); }).catch(() => {});
  }
}

const g2 = globalThis as unknown as { __orbitTopics?: Map<string, { at: number; data: TopicResult }> };
const topicCache = (g2.__orbitTopics ??= new Map());
/** "cs2" → the most viewed videos about Counter-Strike 2 from the last 14 days (101 units: search.list + videos.list; cached 30 min). */
export async function topicVideos(topic: unknown, shorts: boolean): Promise<TopicResult> {
  const q = topicQuery(topic);
  if (!q) throw new ScoutError("Say a topic of 1-60 characters, like “cs2” or “minecraft”");
  const ck = `${q.toLowerCase()}|${shorts}`;
  const hit = topicCache.get(ck);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
  return metered(planTopic, needKey(), async (call) => {
    // 25 results cost the same 100 units as 12, and leave enough after Shorts / live streams are filtered out
    const found = await call<{ items?: { id?: { videoId?: string } }[] }>("search", { part: "snippet", type: "video", q, order: "viewCount", maxResults: "25",
      safeSearch: "moderate", publishedAfter: new Date(Date.now() - 14 * 86_400_000).toISOString(), ...(shorts ? { videoDuration: "short" } : {}) });
    const ids = (found.items ?? []).map((i) => i.id?.videoId ?? "").filter(Boolean);
    const vs = ids.length ? await call<{ items?: unknown[] }>("videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") }) : { items: [] };
    const data: TopicResult = { topic: q, videos: pickVideos(vs.items, shorts, false).sort((a, b) => b.views - a.views).slice(0, 12) };
    pruneCache(topicCache, Date.now(), 30 * 60_000);
    topicCache.set(ck, { at: Date.now(), data });
    return data;
  });
}

/** GET /api/theater: a creator's newest uploads. With `fallback` (only the typed/spoken Find asks; never "All", whose 4 lookups
 *  could otherwise cost 4 × 101 units), a creator YouTube doesn't know becomes a topic search for the same words. */
export async function theater(creator: string | null, topic: string | null, shorts: boolean, fallback = false): Promise<WatchResult | TopicResult> {
  if (topic != null) return topicVideos(topic, shorts);
  try { return await latestVideos(creator, shorts); } catch (e) {
    if (!fallback || !(e instanceof ScoutError && e.status === 404) || !creator?.trim()) throw e; // 404 = no such channel (400 = bad input: shown as is)
    const name = creator.trim().replace(/^@/, "");
    const r = await topicVideos(name, shorts);
    return { ...r, note: `No channel @${name.replace(/\s+/g, "")} — showing videos about “${r.topic}”` };
  }
}
