import { parseChannelInput, parseIsoDuration, type Channel, type Video } from "./youtube-pure";

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

async function api<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const url = `https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`;
  try {
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

async function load(key: string, who: { handle: string } | { id: string }): Promise<Studio> {
  const ch = await api<{ items?: ChannelItem[] }>("channels", { part: "snippet,statistics,contentDetails", ...("handle" in who ? { forHandle: who.handle } : { id: who.id }) }, key);
  const c = ch.items?.[0];
  if (!c) throw new Error("YouTube channel not found. Check YOUTUBE_CHANNEL.");
  const pl = await api<{ items?: { contentDetails: { videoId: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: "50" }, key);
  const ids = (pl.items ?? []).map((i) => i.contentDetails.videoId).filter(Boolean);
  const vs = ids.length ? await api<{ items?: VideoItem[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, key) : { items: [] };
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
    p = load(key, who).finally(() => inflight.delete(raw));
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
