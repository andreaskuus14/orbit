import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, FAST_MODEL } from "./claude";
import { safeFetch } from "./memory";
import {
  MAX_FAVS, WHY_SYSTEM, boundedSet, cleanFavourite, parseExploreSorts, parseIcons, parseLegacyList, parseOpenverse, trendPrompt,
  type Sound, type TrendSort,
} from "./devtools-pure";
import { orbitDataDir } from "./data-dir";
import { findRisers, parseSnaps, pushSnap, toSnapshot, type Riser } from "./trend-rise-pure";
import { findYtRisers, hotTopics, parsePopular, parseYtSnaps, type Topic, type YtRiser } from "./yt-trend-pure";
import { OAuthError, getAccessToken, invalidateAccess, oauthEnv, readStored, type Stored } from "./yt-oauth";
import { VIRAL_CACHE_MS, VIRAL_SEARCH_UNITS, VIRAL_WINDOW_MS, nicheQueries, parseViral, searchIds, type Viral } from "./yt-viral-pure";

// DevWorld game-dev tools: Openverse sound search + local favourites, and the Roblox Trend Radar.
// All outbound HTTP goes through safeFetch (SSRF guard, size cap); results are cached in memory with a size cap.

export type { Sound, TrendSort };
const UA = "ORBIT/0.2 (personal game-dev assistant)";
const getJson = async (url: string, maxBytes = 3_000_000) => (await safeFetch(url, "application/json", UA, maxBytes)).res.json() as Promise<unknown>;

/* ---------- sounds ---------- */

const soundCache = new Map<string, { at: number; p: Promise<Sound[]> }>();
export function searchSounds(q: string, now = Date.now()): Promise<Sound[]> {
  const key = q.toLowerCase();
  const c = soundCache.get(key);
  if (c && now - c.at < 30 * 60_000) return c.p;
  const p = getJson(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=20`).then(parseOpenverse);
  p.catch(() => soundCache.delete(key)); // never cache a failure
  boundedSet(soundCache, key, { at: now, p }, 60);
  return p;
}

const favFile = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "sound-favourites.json");
};
const g = globalThis as unknown as { __orbitFavs?: Promise<unknown> };
/** Favourites errors safe to show the user (never a local path). */
export class FavError extends Error { constructor(m: string, readonly status = 500) { super(m); } }
const unavailable = (e: unknown): never => {
  if (e instanceof FavError) throw e;
  console.error("[devtools] favourites file:", e);
  throw new FavError("Favourites file unavailable");
};
async function readFavs(): Promise<Sound[]> {
  try {
    const j = JSON.parse(await readFile(favFile(), "utf8"));
    return (Array.isArray(j) ? j : []).map(cleanFavourite).filter((s): s is Sound => !!s);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    return unavailable(e); // locked/corrupt: never overwrite
  }
}
function updateFavs(fn: (f: Sound[]) => Sound[]): Promise<Sound[]> {
  const p = (g.__orbitFavs ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await readFavs()).slice(0, MAX_FAVS);
    try {
      await mkdir(path.dirname(favFile()), { recursive: true });
      await writeFile(favFile() + ".tmp", JSON.stringify(next, null, 2));
      await rename(favFile() + ".tmp", favFile());
    } catch (e) { unavailable(e); }
    return next;
  });
  g.__orbitFavs = p;
  return p;
}
export const getFavourites = readFavs;
export const addFavourite = (s: Sound) => updateFavs((f) => {
  if (f.length >= MAX_FAVS && !f.some((x) => x.id === s.id)) throw new FavError(`Favourites full (${MAX_FAVS})`, 400);
  return [s, ...f.filter((x) => x.id !== s.id)];
});
export const removeFavourite = (id: string) => updateFavs((f) => f.filter((x) => x.id !== id));

/* ---------- Roblox Trend Radar ---------- */

export type YtTrends = { risers: YtRiser[]; topics: Topic[]; region: string; hint?: string; error?: string };
export type Trends = { source: string; sorts: TrendSort[]; at: number; error?: string; tried: string[]; risers?: Riser[]; yt?: YtTrends };

/** Append a snapshot to <data dir>/<name> (atomic; 7 days / 200 max) and return the whole history. Throws on I/O errors. */
async function appendHistory<T extends { at: number }>(name: string, parse: (j: unknown) => T[], snap: T): Promise<T[]> {
  const file = path.join(orbitDataDir(), name);
  const old = parse(JSON.parse(await readFile(file, "utf8").catch(() => "[]"))); // shortcut: a corrupt file restarts history (it's only a cache)
  const snaps = pushSnap(old, snap);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", JSON.stringify(snaps));
  await rename(file + ".tmp", file);
  return snaps;
}

/** Append a snapshot to trend-history.json and return current risers. Never throws. */
async function recordSnapshot(sorts: TrendSort[], now: number): Promise<Riser[]> {
  try {
    return findRisers(await appendHistory("trend-history.json", parseSnaps, toSnapshot(sorts, now)));
  } catch (e) {
    console.error("[devtools] trend history:", e instanceof Error ? e.message : e);
    return [];
  }
}

/* YouTube Gaming chart via the owner's STUDIO OAuth grant (youtube.readonly; videos.list = 1 quota unit per call). Never throws. */
const YT_REGION = "US";
const YT_HINT = "Connect YouTube in STUDIO to see YouTube trends";
async function popular(token: string): Promise<Response> {
  const url = `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet,statistics", chart: "mostPopular", videoCategoryId: "20", regionCode: YT_REGION, maxResults: "50" })}`;
  return fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
}
async function ytTrends(now: number): Promise<YtTrends> {
  const out: YtTrends = { risers: [], topics: [], region: YT_REGION };
  const s = oauthEnv() ? await readStored() : null;
  if (!s) return { ...out, hint: YT_HINT };
  let token = "";
  try {
    token = await getAccessToken(s);
    let res = await popular(token);
    if (res.status === 401) { invalidateAccess(); token = await getAccessToken(s); res = await popular(token); } // token revoked/rotated early
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`YouTube API ${res.status}: ${String(json?.error?.message ?? res.statusText).slice(0, 200)}`);
    const snap = parsePopular(json, now);
    out.topics = hotTopics(snap.videos.map((v) => v.title));
    if (snap.videos.length) try { // an empty chart as baseline would make the whole next top 25 look "new"
      out.risers = findYtRisers(await appendHistory("yt-trend-history.json", parseYtSnaps, snap));
    } catch (e) { console.error("[devtools] yt trend history:", e instanceof Error ? e.message : e); }
    return out;
  } catch (e) {
    if (e instanceof OAuthError) return { ...out, hint: e.message === "invalid_grant" ? "YouTube sign-in expired. Reconnect in STUDIO to see YouTube trends" : YT_HINT };
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "YouTube API timed out" : e.message) : "YouTube request failed";
    return { ...out, error: token ? msg.split(token).join("***") : msg };
  }
}

/* "Blowing up in your niche": up to 3 search.list calls (100 units each) + 1 videos.list, same OAuth grant as above. Fetched only when the Rising
   tab is opened, cached 3 h, charged to the scout's daily budget (scout.json quota) so both stay under the project's 10,000 units. Never throws. */
export type NicheViral = { videos: Viral[]; queries: string[]; units: number; at: number; hint?: string; error?: string };
async function ytGet(path: string, params: Record<string, string>, s: Stored): Promise<unknown> {
  const call = async () => fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`,
    { headers: { authorization: `Bearer ${await getAccessToken(s)}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  let res = await call();
  if (res.status === 401) { invalidateAccess(); res = await call(); } // token revoked/rotated early
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${String(json?.error?.message ?? res.statusText).slice(0, 200)}`);
  return json;
}
async function scanNiche(now: number): Promise<NicheViral> {
  const out: NicheViral = { videos: [], queries: [], units: 0, at: now };
  const s = oauthEnv() ? await readStored() : null;
  if (!s) return { ...out, hint: YT_HINT };
  try {
    const [{ scoutView, updateScout }, { readState, studioRoot }, { judgeShorts, learnProblem }, { allKeywords, charge }] = await Promise.all([
      import("./clips/scout"), import("./clips/factory"), import("./clips/learn-pure"), import("./clips/scout-pure")]);
    const sv = await scoutView();
    const ls = await readState<import("./clips/learn-pure").LearnState>(studioRoot(), "learn", learnProblem);
    const winners = judgeShorts(Object.values(ls?.clips ?? {})).filter((j) => j.verdict === "winner").map((j) => j.f.creator);
    out.queries = nicheQueries(winners, sv.scout.watchlist.map((w) => w.title), allKeywords(sv.scout));
    if (!out.queries.length) return { ...out, hint: "Add creators or keywords in the Video Scout (or publish a few Shorts) to scan your niche" };
    if (sv.usedToday + out.queries.length * VIRAL_SEARCH_UNITS + 1 > sv.budget) return { ...out, hint: "Today's YouTube quota budget is used up; try again tomorrow" };
    const after = new Date(now - VIRAL_WINDOW_MS).toISOString(), found: unknown[] = [];
    try {
      for (const q of out.queries) {
        found.push(await ytGet("search", { part: "id", type: "video", videoDuration: "short", order: "viewCount", publishedAfter: after, maxResults: "15", q }, s));
        out.units += VIRAL_SEARCH_UNITS;
      }
      const ids = searchIds(...found).slice(0, 50);
      if (ids.length) { out.videos = parseViral(await ytGet("videos", { part: "snippet,statistics", id: ids.join(",") }, s), now); out.units += 1; }
    } finally {
      if (out.units) await updateScout((x) => { x.quota = charge(x.quota, out.units, new Date(now)); }).catch(() => {});
    }
    return out;
  } catch (e) {
    if (e instanceof OAuthError) return { ...out, hint: e.message === "invalid_grant" ? "YouTube sign-in expired. Reconnect in STUDIO" : YT_HINT };
    return { ...out, error: e instanceof Error ? (e.name === "TimeoutError" ? "YouTube API timed out" : e.message) : "YouTube request failed" }; // ytGet never puts the token in a message
  }
}
const vc = globalThis as unknown as { __orbitViral?: { at: number; p: Promise<NicheViral> } };
export function nicheViral(now = Date.now()): Promise<NicheViral> {
  if (vc.__orbitViral && now - vc.__orbitViral.at < VIRAL_CACHE_MS) return vc.__orbitViral.p;
  const p = scanNiche(now);
  vc.__orbitViral = { at: now, p };
  void p.then((r) => { if ((r.error || r.hint) && vc.__orbitViral?.p === p) vc.__orbitViral = { at: now - VIRAL_CACHE_MS + 10 * 60_000, p }; }); // retry a failure after 10 min
  return p;
}

async function fromExplore(): Promise<TrendSort[]> {
  const sid = randomUUID();
  const j = await getJson(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${sid}`);
  let sorts = parseExploreSorts(j);
  // get-sorts usually carries the games inline (Oct 2026); if a wanted sort came back empty, ask for its content directly.
  const empty = ["top-trending", "up-and-coming"].filter((id) => !sorts.some((s) => s.id === id && s.games.length));
  for (const id of empty) {
    const more = parseExploreSorts(await getJson(`https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${sid}&sortId=${id}`).catch(() => null));
    sorts = [...sorts.filter((s) => s.id !== id), ...more];
  }
  return sorts.filter((s) => s.games.length);
}
async function fromLegacy(): Promise<TrendSort[]> {
  // shortcut: older games API answered 404 when checked (Oct 2026); kept as a best-effort fallback, shape unverified.
  const j = (await getJson("https://games.roblox.com/v1/games/sorts?model.gameSortsContext=GamesDefaultSorts")) as { sorts?: { token?: unknown; displayName?: unknown }[] };
  const s = (j.sorts ?? []).find((x) => typeof x.token === "string") ?? null;
  if (!s) throw new Error("no sorts");
  const list = parseLegacyList(await getJson(`https://games.roblox.com/v1/games/list?model.sortToken=${encodeURIComponent(String(s.token))}&model.maxRows=15`), String(s.displayName ?? "Popular"));
  return list?.games.length ? [list] : [];
}
async function addIcons(sorts: TrendSort[]) {
  const ids = [...new Set(sorts.flatMap((s) => s.games.map((x) => x.universeId)))].slice(0, 100);
  if (!ids.length) return;
  const icons = parseIcons(await getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids.join(",")}&size=150x150&format=Png&isCircular=false`).catch(() => null));
  for (const s of sorts) for (const x of s.games) x.icon = icons.get(x.universeId) ?? null;
}

const TREND_MS = 30 * 60_000;
const tc = globalThis as unknown as { __orbitTrends?: { at: number; p: Promise<Trends> } };
export function getTrends(now = Date.now()): Promise<Trends> {
  if (tc.__orbitTrends && now - tc.__orbitTrends.at < TREND_MS) return tc.__orbitTrends.p;
  const p = (async (): Promise<Trends> => {
    const ytP = ytTrends(now); // in parallel with Roblox; same 30-min cache, fetched only when the radar is viewed
    const tried: string[] = [];
    for (const [source, fn] of [["Roblox explore API (get-sorts)", fromExplore], ["Roblox games API (legacy sorts)", fromLegacy]] as const) {
      try {
        const sorts = await fn();
        if (sorts.length) { await addIcons(sorts); return { source, sorts, at: now, tried, risers: await recordSnapshot(sorts, now), yt: await ytP }; }
        tried.push(`${source}: no games returned`);
      } catch (e) { tried.push(`${source}: ${(e as Error).message}`); }
    }
    return { source: "none", sorts: [], at: now, tried, error: "Roblox didn't return any public game lists right now.", yt: await ytP };
  })();
  tc.__orbitTrends = { at: now, p };
  void p.then((t) => { if (!t.sorts.length && tc.__orbitTrends?.p === p) tc.__orbitTrends = { at: now - TREND_MS + 2 * 60_000, p }; }); // retry a failure after 2 min
  return p;
}

const WHY_MS = 6 * 3600_000;
const wc = globalThis as unknown as { __orbitWhy?: { at: number; key: string; p: Promise<{ text: string; at: number }> } };
/** "Why is it trending?": the current list (data only) → patterns + ideas. Cached 6 h per list. */
export async function whyTrending(sb: SupabaseClient, userId: string, now = Date.now()): Promise<{ text: string; at: number; source: string }> {
  const t = await getTrends(now);
  if (!t.sorts.length) throw new Error(t.error ?? "No trend data");
  const prompt = trendPrompt(t.sorts);
  const key = t.source; // the list drifts every refresh; one analysis per source per 6 h keeps AI cost flat
  const c = wc.__orbitWhy;
  if (c && c.key === key && now - c.at < WHY_MS) return { ...(await c.p), source: t.source };
  const p = askClaude(prompt, WHY_SYSTEM, { lane: "background", model: FAST_MODEL }).then(async (r) => {
    await recordUsage(sb, userId, "devtools.trends", r, FAST_MODEL).catch(() => {});
    return { text: r.text.slice(0, 4000), at: now };
  });
  wc.__orbitWhy = { at: now, key, p };
  p.catch(() => { if (wc.__orbitWhy?.p === p) wc.__orbitWhy = undefined; });
  return { ...(await p), source: t.source };
}
