import { readFile } from "node:fs/promises";
import path from "node:path";
import { api } from "./youtube";
import { parseCreatorInput } from "./youtube-pure";
import { saveState, studioRoot } from "./clips/factory";
import { ScoutError, lookupChannel, updateScout, type Call } from "./clips/scout";
import { DAILY_UNITS, charge, usedToday } from "./clips/scout-pure";
import { pickLatest, planWatch, type WatchVideo } from "./watch-pure";

// THEATER lookup: a spoken creator name → their newest uploads in 2-3 YouTube units (counted in the scout's daily budget).
// Channel ids are remembered in <studio>/watch-channels.json; results are cached 10 minutes.

export type WatchResult = { channel: { id: string; title: string }; videos: WatchVideo[] };
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
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new ScoutError("Add YOUTUBE_API_KEY to .env.local first", 503);

  const ids = await readIds();
  let ch = Object.hasOwn(ids, key) ? ids[key] : undefined;
  // Reserve the units up front (check + charge in one locked step), refund what wasn't used: parallel lookups can't overshoot.
  const plan = await updateScout((x) => {
    const p = planWatch(!!ch, DAILY_UNITS - usedToday(x.quota, new Date()));
    if (typeof p === "string") throw new ScoutError(p, 429);
    x.quota = charge(x.quota, p, new Date());
    return p;
  });

  let units = 0;
  const call: Call = (p, params) => { units++; return api(p, params, apiKey); }; // Google bills failed calls too
  try {
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
    cache.set(ck, { at: Date.now(), data });
    return data;
  } finally {
    if (units < plan) await updateScout((x) => { x.quota = charge(x.quota, units - plan, new Date()); x.quota.used = Math.max(0, x.quota.used); }).catch(() => {});
  }
}
