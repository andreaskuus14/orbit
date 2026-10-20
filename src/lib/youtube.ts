import { parseChannelInput, parseIsoDuration, type Channel, type Video } from "./youtube-pure";
import { createHash } from "node:crypto";
import { meterYoutube, withYoutubeBudget } from "./youtube-quota";
import { uniqueVideoIds } from "./youtube-quota-pure";

const requests = globalThis as unknown as { __orbitYoutubeRequests?: Map<string, { at: number; p: Promise<unknown> }> };
const requestCache = requests.__orbitYoutubeRequests ??= new Map();
export const requestIdentity = (endpoint: string, params: Record<string, string>, credential: string) =>
  createHash("sha256").update(JSON.stringify([credential, endpoint, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
export function cachedYoutube<T>(identity: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now(), hit = requestCache.get(identity);
  if (hit && now - hit.at < ttl) return hit.p as Promise<T>;
  const p = Promise.resolve().then(fetcher);
  requestCache.set(identity, { at: now, p });
  for (const [k, c] of requestCache) if (now - c.at > 6 * 3_600_000 || requestCache.size > 500) requestCache.delete(k);
  void p.catch(() => { if (requestCache.get(identity)?.p === p) requestCache.delete(identity); });
  return p;
}
export const youtubeCacheMs = (endpoint: string) => endpoint === "channels" ? 6 * 3_600_000 : ["search", "playlistItems"].includes(endpoint) ? 3 * 3_600_000 : 10 * 60_000;
/** One run, one lookup per video ID, including missing/private IDs and IDs repeated by different searches. */
export function videoReader(call: (params: Record<string, string>) => Promise<{ items?: unknown[] }>, part: string) {
  const requested = new Set<string>(), items = new Map<string, unknown>();
  return async (ids: string[]): Promise<unknown[]> => {
    const unique = uniqueVideoIds(ids), fresh = unique.filter((id) => !requested.has(id));
    for (const id of fresh) requested.add(id);
    for (let i = 0; i < fresh.length; i += 50) {
      const r = await call({ part, id: fresh.slice(i, i + 50).join(",") });
      for (const v of r.items ?? []) if (v && typeof (v as { id?: unknown }).id === "string") items.set((v as { id: string }).id, v);
    }
    return unique.flatMap((id) => items.has(id) ? [items.get(id)] : []);
  };
}

// STUDIO: the owner's channel from the YouTube Data API v3 (fixed Google host, key from env; never logged or returned).
export type Studio =
  | { configured: false; error?: string }
  | { configured: true; channel: Channel; videos: Video[]; fetchedAt: string };

type Thumbs = Record<string, { url?: string } | undefined> | undefined;
const thumbOf = (t: Thumbs) => t?.medium?.url ?? t?.high?.url ?? t?.default?.url ?? "";
const num = (s: unknown) => (Number.isFinite(Number(s)) ? Number(s) : 0);

const g = globalThis as unknown as { __orbitStudioCache?: Map<string, { at: number; data: Studio }> };
const cache = (g.__orbitStudioCache ??= new Map());
const inflight = new Map<string, Promise<Studio>>();
const failed = new Map<string, { at: number; err: unknown }>();

export async function api<T>(path: string, params: Record<string, string>, key: string, ttl = youtubeCacheMs(path)): Promise<T> {
  return cachedYoutube(requestIdentity(path, params, key), ttl, () => fetchApi<T>(path, params, key));
}
async function fetchApi<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const url = `https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`;
  try {
    meterYoutube(path);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`YouTube API ${res.status}: ${json?.error?.message ?? res.statusText}`);
    return json as T;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "YouTube API timed out" : e.message) : "YouTube API request failed";
    throw new Error(msg.split(key).join("***"));
  }
}

type ChannelItem = {
  snippet: { title: string; customUrl?: string; thumbnails?: Thumbs };
  statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
};
type VideoItem = {
  id: string;
  snippet: { title: string; publishedAt: string; thumbnails?: Thumbs };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

async function load(key: string, who: { handle: string } | { id: string }, force: boolean): Promise<Studio> {
  const ttl = force ? 60_000 : 10 * 60_000; // owner stats retain their original freshness, including uploads
  const ch = await api<{ items?: ChannelItem[] }>("channels", { part: "snippet,statistics,contentDetails", ...("handle" in who ? { forHandle: who.handle } : { id: who.id }) }, key, ttl);
  const c = ch.items?.[0];
  if (!c) throw new Error("YouTube channel not found. Check YOUTUBE_CHANNEL.");
  // A channel with no uploads has no uploads playlist yet: YouTube answers 404 rather than an empty list.
  const pl = await api<{ items?: { contentDetails: { videoId: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: "50" }, key, ttl)
    .catch((e: Error) => { if (/^YouTube API 404/.test(e.message)) return { items: [] }; throw e; });
  const ids = (pl.items ?? []).map((i) => i.contentDetails.videoId).filter(Boolean);
  const vs = ids.length ? await api<{ items?: VideoItem[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, key, ttl) : { items: [] };
  const videos: Video[] = (vs.items ?? []).map((v) => ({
    id: v.id, title: v.snippet.title, publishedAt: v.snippet.publishedAt,
    views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount),
    durationSec: parseIsoDuration(v.contentDetails?.duration), thumb: thumbOf(v.snippet.thumbnails),
  })).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return {
    configured: true,
    channel: {
      title: c.snippet.title, handle: c.snippet.customUrl ?? ("handle" in who ? who.handle : ""), thumb: thumbOf(c.snippet.thumbnails),
      subs: num(c.statistics.subscriberCount), views: num(c.statistics.viewCount), videoCount: num(c.statistics.videoCount),
    },
    videos, fetchedAt: new Date().toISOString(),
  };
}

/** Cached 10 min per channel; `force` refetches, but at most once a minute (protects the daily API quota). */
export async function getStudio(force = false): Promise<Studio> {
  return withYoutubeBudget("studio-stats", "manual", () => studio(force));
}
async function studio(force: boolean): Promise<Studio> {
  const key = process.env.YOUTUBE_API_KEY?.trim(), raw = process.env.YOUTUBE_CHANNEL?.trim();
  if (!key || !raw) return { configured: false };
  const who = parseChannelInput(raw);
  if (!who) return { configured: false, error: "YOUTUBE_CHANNEL must be @handle, a UC… channel id, or a youtube.com/@handle URL." };
  const hit = cache.get(raw), age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < (force ? 60_000 : 10 * 60_000)) return hit.data;
  const fail = failed.get(raw);
  if (fail && Date.now() - fail.at < 60_000) { if (hit) return hit.data; throw fail.err; } // don't burn quota retrying a broken config
  let p = inflight.get(raw);
  if (!p) {
    p = load(key, who, force).finally(() => inflight.delete(raw));
    inflight.set(raw, p); // parallel cold requests share one fetch
  }
  try {
    const data = await p;
    cache.set(raw, { at: Date.now(), data }); failed.delete(raw);
    return data;
  } catch (err) {
    failed.set(raw, { at: Date.now(), err });
    if (hit) return hit.data; // stale beats an error
    throw err;
  }
}
