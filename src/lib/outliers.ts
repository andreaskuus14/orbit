import { api, videoReader } from "./youtube";
import { parseCreatorInput } from "./youtube-pure";
import { lookupChannel, type Call } from "./clips/scout";
import { withYoutubeBudget } from "./youtube-quota";
import { fenceUntrusted } from "./reach/pure";
import { outlierLines, parseOutlierInput, scoreOutliers, type OutlierVideo } from "./outliers-pure";

// CORE's find_outliers: free (YouTube Data API key, manual quota share). Channel: uploads playlist (1 unit) + videos (1 unit).
// Query: one search (100 units) + 1 videos call, then each found channel's last 30 uploads (1 unit a channel + videos batched 50 a call).
type Page<T> = { items?: T[] };
type VideoItem = { id?: string; snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string }; statistics?: { viewCount?: string } };
const RECENT = "30";

const toVideo = (v: VideoItem): OutlierVideo | null => v.id && v.snippet?.channelId && v.snippet.publishedAt
  ? { id: v.id, title: v.snippet.title ?? "", channelId: v.snippet.channelId, channel: v.snippet.channelTitle ?? "", views: Number(v.statistics?.viewCount) || 0, publishedAt: v.snippet.publishedAt }
  : null;

/** Recent upload ids per channel (1 playlistItems unit each); the videos.list reads are batched by the caller. */
async function uploadIds(call: Call, channelId: string): Promise<string[]> {
  const pl = await call<Page<{ contentDetails?: { videoId?: string } }>>("playlistItems", { part: "contentDetails", playlistId: `UU${channelId.slice(2)}`, maxResults: RECENT })
    .catch((e: Error) => { if (/^YouTube API 404/.test(e.message)) return { items: [] }; throw e; }); // no uploads yet
  return (pl.items ?? []).map((i) => i.contentDetails?.videoId ?? "");
}
const videosOf = async (read: (ids: string[]) => Promise<unknown[]>, ids: string[]) => (await read(ids)).flatMap((v) => toVideo(v as VideoItem) ?? []);
const group = (vs: OutlierVideo[]) => { const m = new Map<string, OutlierVideo[]>(); for (const v of vs) m.set(v.channelId, [...(m.get(v.channelId) ?? []), v]); return m; };

export async function runOutliersTool(input: Record<string, unknown>): Promise<string> {
  const p = parseOutlierInput(input);
  if ("error" in p) return p.error;
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return "Error: YOUTUBE_API_KEY is not set. Add a YouTube Data API v3 key to .env.local (see .env.example) and restart ORBIT.";
  try {
    return await withYoutubeBudget("outliers", "manual", async () => {
      const call: Call = (endpoint, params) => api(endpoint, params, key);
      const read = videoReader((params) => call("videos", params), "snippet,statistics"); // 50 ids a call, each id once a run
      const now = Date.now();
      let candidates: OutlierVideo[], byChannel: Map<string, OutlierVideo[]>, label: string;
      if (p.channel) {
        const who = parseCreatorInput(p.channel);
        if (!who) return "Error: channel must be an @handle, a youtube.com channel/video URL, or a UC… channel id";
        const ch = await lookupChannel(who, call);
        if (!ch?.id) return `Error: YouTube has no channel "${p.channel}"; try the exact @handle from their channel page`;
        candidates = await videosOf(read, await uploadIds(call, ch.id));
        byChannel = new Map([[ch.id, candidates]]);
        label = `Outliers on ${ch.snippet?.title ?? p.channel} (last ${candidates.length} uploads)`;
      } else {
        const found = await call<Page<{ id?: { videoId?: string } }>>("search", { part: "id", type: "video", q: p.query!, maxResults: "25", safeSearch: "moderate" });
        candidates = await videosOf(read, (found.items ?? []).map((i) => i.id?.videoId ?? ""));
        const ids = (await Promise.all([...new Set(candidates.map((c) => c.channelId))].map((id) => uploadIds(call, id)))).flat();
        byChannel = group(await videosOf(read, ids)); // all channels' uploads in one batched read (50 a call); search hits aren't re-read
        label = `Outliers for "${p.query}" (${candidates.length} search results, each vs its own channel's last ${RECENT} uploads)`;
      }
      return fenceUntrusted(label, `${outlierLines(scoreOutliers(candidates, byChannel, now, p.limit), now)}\nScore = views / the channel's median views (uploads older than 48 h).`, 6000);
    });
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
  }
}
