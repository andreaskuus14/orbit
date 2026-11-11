import { randomUUID } from "node:crypto";
import path from "node:path";
import { api, videoReader } from "./youtube";
import { readState, saveState, studioRoot } from "./clips/factory";
import { updateIdeas } from "./ideas";
import { parseCreatorInput } from "./youtube-pure";
import { ScoutError, lookupChannel, type Call } from "./clips/scout";
import { YoutubeQuotaError, withYoutubeBudget } from "./youtube-quota";
import { mergeOutlierIdeas, outlierQueries, outlierReport, outliersDue, parseOutlierInput, scoreOutliers, toVideo, type Outlier, type OutlierInput, type OutlierVideo, type VideoItem } from "./outliers-pure";

// CORE's find_outliers: free (YouTube Data API key, manual quota share). Channel: uploads playlist (1 unit) + videos (1 unit).
// Query: one search (100 units) + 1 videos call, then each found channel's last 30 uploads (1 unit a channel + videos batched 50 a call).
type Page<T> = { items?: T[] };
const RECENT = "30";

/** Recent upload ids per channel (1 playlistItems unit each); the videos.list reads are batched by the caller. */
async function uploadIds(call: Call, channelId: string): Promise<string[]> {
  const pl = await call<Page<{ contentDetails?: { videoId?: string } }>>("playlistItems", { part: "contentDetails", playlistId: `UU${channelId.slice(2)}`, maxResults: RECENT })
    .catch((e: Error) => { if (/^YouTube API 404/.test(e.message)) return { items: [] }; throw e; }); // no uploads yet
  return (pl.items ?? []).map((i) => i.contentDetails?.videoId ?? "");
}
const videosOf = async (read: (ids: string[]) => Promise<unknown[]>, ids: string[]) => (await read(ids)).flatMap((v) => toVideo(v as VideoItem) ?? []);
const group = (vs: OutlierVideo[]) => { const m = new Map<string, OutlierVideo[]>(); for (const v of vs) m.set(v.channelId, [...(m.get(v.channelId) ?? []), v]); return m; };

type Gathered = { label: string; candidates: OutlierVideo[]; byChannel: Map<string, OutlierVideo[]> } | string; // string = a user-facing error

/** The YouTube reads shared by the tool and the weekly run. Throws on API/quota errors. */
async function gather(p: OutlierInput, key: string): Promise<Gathered> {
  const call: Call = (endpoint, params) => api(endpoint, params, key);
  const read = videoReader((params) => call("videos", params), "snippet,statistics"); // 50 ids a call, each id once a run
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
    const ids = (await Promise.all([...new Set(candidates.map((c) => c.channelId))].map((id) => uploadIds(call, id).catch((e) => {
      if (e instanceof YoutubeQuotaError) throw e;
      return [] as string[]; // one channel's 403/5xx: that channel just has no baseline
    })))).flat();
    byChannel = group(await videosOf(read, ids)); // all channels' uploads in one batched read (50 a call); search hits aren't re-read
    label = `Outliers for "${p.query}" (${candidates.length} search results, each vs its own channel's last ${RECENT} uploads)`;
  }
  return { label, candidates, byChannel };
}

/** Google's error text is remote: keep only the status (our own quota/lookup messages are safe to show). */
function failText(e: unknown) {
  const msg = e instanceof Error ? e.message : "", status = /^YouTube API (?:\d{3}|timed out)/.exec(msg)?.[0];
  return `Error: ${status ?? (e instanceof YoutubeQuotaError || e instanceof ScoutError ? msg.slice(0, 200) : "YouTube request failed")}`;
}

export async function runOutliersTool(input: Record<string, unknown>): Promise<string> {
  const p = parseOutlierInput(input);
  if ("error" in p) return p.error;
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return "Error: YOUTUBE_API_KEY is not set. Add a YouTube Data API v3 key to .env.local (see .env.example) and restart ORBIT.";
  try {
    return await withYoutubeBudget("outliers", "manual", async () => {
      const g = await gather(p, key);
      return typeof g === "string" ? g : outlierReport(g.label, g.candidates, g.byChannel, Date.now(), p.limit);
    });
  } catch (e) { return failText(e); }
}

// Weekly run (scheduler tick): his scout keywords → find_outliers → IDEA RADAR ideas (ideas.json). Read-only: sends and publishes nothing.
// Quota: scout share, at most OUTLIER_QUERIES searches a week. No YOUTUBE_API_KEY or no keywords: returns quietly, nothing stamped.
// State: <studio>/outliers.json = {checkedAt, status, added}; stamped even after a failure so a broken key doesn't retry every tick.
type RunState = { v: 1; checkedAt: string; status: string; added: number };
const runProblem = (x: unknown) => (x as RunState)?.v === 1 && typeof (x as RunState).checkedAt === "string" ? "" : "not an outliers state";
export const outliersView = () => readState<RunState>(studioRoot(), "outliers", runProblem);

const g = globalThis as unknown as { __orbitOutliersBusy?: boolean }; // global like niche.ts's busy flag: survives hot reloads
export async function maybeWeeklyOutliers(now = Date.now()): Promise<void> {
  if (g.__orbitOutliersBusy) return; // a run takes minutes and the tick fires every minute: no second set of searches while one runs
  g.__orbitOutliersBusy = true;
  try {
    const key = process.env.YOUTUBE_API_KEY?.trim();
    if (!key) return;
    const prev = await outliersView();
    if (!outliersDue(prev?.checkedAt, now)) return;
    const { scoutView } = await import("./clips/scout");
    const { scout } = await scoutView();
    const queries = outlierQueries([...scout.keywords, ...scout.aiKeywords]);
    if (!queries.length) return;
    const found: { query: string; list: Outlier[] }[] = [], errors: string[] = [];
    await withYoutubeBudget("outliers-weekly", "scout", async () => {
      for (const query of queries) {
        try {
          const g = await gather({ query, limit: 10 }, key);
          if (typeof g !== "string") found.push({ query, list: scoreOutliers(g.candidates, g.byChannel, now, 10) });
        } catch (e) { errors.push(failText(e)); if (e instanceof YoutubeQuotaError) break; }
      }
    });
    let added = 0;
    if (found.some((f) => f.list.length)) await updateIdeas((ideas) => { const r = mergeOutlierIdeas(ideas, found, new Date(now).toISOString(), randomUUID); added = r.added; return r.ideas; });
    const status = `${queries.length} search${queries.length === 1 ? "" : "es"} · ${added} new idea${added === 1 ? "" : "s"}${errors.length ? ` · ${errors.length} failed: ${errors[0]}` : ""}`.slice(0, 300);
    await saveState("outliers", path.join(studioRoot(), "outliers.json"), { v: 1, checkedAt: new Date(now).toISOString(), status, added } satisfies RunState);
  } catch (e) { console.error("[orbit] weekly outliers failed:", e instanceof Error ? e.message : String(e)); }
  finally { g.__orbitOutliersBusy = false; }
}
