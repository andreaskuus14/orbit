// YouTube autopilot research, disk/network side (rules and maths: yt-research-pure.ts). Public data only:
//  - yt-dlp (Unlicense) reads public metadata as JSON: searches, a channel's recent uploads, one video's details. Always with
//    --skip-download, --ignore-config and no cookies: nothing is downloaded, nobody is logged in. One call at a time with a gap.
//  - public captions (youtube.com/api/timedtext links yt-dlp lists) and the public thumbnail, read through safeFetch.
//  - Google Trends (public widget endpoints) and Reddit's public JSON, with the web ladder (fetch → Scrapling → browser) reading
//    old.reddit.com when the JSON is refused. Either may be unavailable (they block many IPs); that's reported, not hidden.
//  - optional: YOUTUBE_API_KEY (free quota, the "manual" share) fills exact upload dates for the shortlisted videos.
// Nothing is posted, uploaded or downloaded for reuse.
import { spawn } from "node:child_process";
import { safeFetch } from "./memory";
import { ladderRead, newLookup } from "./web-ladder";
import { askClaude, MODEL } from "./claude";
import { jsonObject } from "./clips/story-pure";
import { ytdlpPath } from "./clips/factory";
import { stopAllOn } from "./stop-all";
import { api } from "./youtube";
import { withYoutubeBudget } from "./youtube-quota";
import {
  LIMITS, THUMB_PROMPT, THUMB_SYSTEM, WHY_SYSTEM, channelsToRead, clusterTitles, fallbackWhy, featureLift, hookText, nicheStop, onNiche, pacing, parseChannelTab, parseDetail,
  parseJson3, parseRedditSearch, parseSearch, parseTrendsTimeline, parseVtt, postingTime, rankOutliers, redditBuzz, titleFeatures, trendDirection, validThumb, validWhy, whyPrompt,
  type ChannelTab, type Cue, type Direction, type Evidence, type Lift, type ResearchInput, type Scored, type Thumb, type TitleFeature, type VideoDetail, type Why, type YtVideo,
} from "./yt-research-pure";

const GAP_MS = 1_500; // between yt-dlp calls: well under what a person browsing does
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export class ResearchError extends Error {}
type Run = { calls: number; last: number; signal?: AbortSignal; log: string[] };

async function ytdlp(run: Run, args: string[], timeoutMs = 90_000): Promise<unknown> {
  if (stopAllOn()) throw new ResearchError("Stop-all is on");
  if (run.signal?.aborted) throw new ResearchError("cancelled");
  if (run.calls >= LIMITS.calls) throw new ResearchError("call cap reached");
  const bin = process.env.ORBIT_YTDLP_RESEARCH || (await ytdlpPath());
  if (!bin) throw new ResearchError("yt-dlp is missing: winget install yt-dlp.yt-dlp");
  const wait = run.last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  run.calls++; run.last = Date.now();
  const full = ["--ignore-config", "--no-cookies-from-browser", "--skip-download", "--no-warnings", "--no-playlist-reverse", "-J", ...args];
  return new Promise((resolve, reject) => {
    const p = spawn(bin, full, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, windowsHide: true, signal: run.signal });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; if (out.length > 30_000_000) p.kill(); });
    p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    p.on("error", (e) => reject(new ResearchError(`yt-dlp didn't start: ${e.message}`)));
    p.on("close", (code) => {
      try { resolve(JSON.parse(out)); }
      catch { reject(new ResearchError(`yt-dlp failed (${code}): ${err.trim().split("\n").pop()?.slice(0, 200) ?? "no output"}`)); }
    });
  });
}

const search = async (run: Run, q: string, n: number) => parseSearch(await ytdlp(run, ["--flat-playlist", `ytsearch${n}:${q}`]));
async function channelTab(run: Run, id: string): Promise<ChannelTab | null> {
  const out: { tab: string; t: ChannelTab }[] = [];
  for (const tab of ["videos", "shorts"]) {
    try { const t = parseChannelTab(await ytdlp(run, ["--flat-playlist", "--playlist-end", "30", `https://www.youtube.com/channel/${id}/${tab}`])); if (t) out.push({ tab, t }); }
    catch (e) { if (e instanceof ResearchError && /call cap|Stop-all|cancelled/.test(e.message)) throw e; } // a channel without that tab
  }
  if (!out.length) return null;
  return { ...out[0].t, subscribers: out.find((o) => o.t.subscribers)?.t.subscribers ?? null,
    videos: out.flatMap((o) => o.t.videos.map((v) => ({ ...v, isShort: o.tab === "shorts" || v.isShort }))) };
}
const detail = async (run: Run, id: string) => parseDetail(await ytdlp(run, [`https://www.youtube.com/watch?v=${id}`]));

async function captions(d: VideoDetail): Promise<Cue[]> {
  if (!d.captionUrl) return [];
  try {
    const url = d.captionFormat === "json3" ? d.captionUrl.replace(/([?&])fmt=[^&]*/, "$1fmt=json3") : d.captionUrl;
    const { body } = await safeFetch(url, "*/*", UA, 3_000_000, 15_000);
    const text = new TextDecoder().decode(body);
    return d.captionFormat === "json3" ? parseJson3(JSON.parse(text)) : parseVtt(text);
  } catch { return []; }
}

/** Claude vision on the public thumbnail: described, never reused. */
async function thumbTraits(d: YtVideo, signal?: AbortSignal): Promise<Thumb | null> {
  try {
    const { res, body } = await safeFetch(d.thumb.replace(/\/[^/]+\.jpg$/, "/hqdefault.jpg"), "image/jpeg,image/webp,image/*", UA, 2_000_000, 15_000);
    if (!/^image\//.test(res.headers.get("content-type") ?? "")) return null;
    const r = await askClaude(THUMB_PROMPT, THUMB_SYSTEM, { model: MODEL, images: [{ type: res.headers.get("content-type")!.split(";")[0], data: body }], signal, purpose: "yt-autopilot thumbnail", timeoutMs: 90_000 });
    return validThumb(jsonObject(r.text));
  } catch { return null; }
}

/** Google Trends, YouTube search interest over 12 months. "unknown" when Google refuses (it often does for bots / shared IPs). */
export async function trendsFor(topic: string): Promise<Direction> {
  try {
    const req = { comparisonItem: [{ keyword: topic, geo: "", time: "today 12-m" }], category: 0, property: "youtube" };
    const { body } = await safeFetch(`https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(req))}`, "application/json", UA, 500_000, 12_000);
    const ex = JSON.parse(new TextDecoder().decode(body).replace(/^\)\]\}',?\s*/, "")) as { widgets?: { id?: string; token?: string; request?: unknown }[] };
    const w = ex.widgets?.find((x) => x.id === "TIMESERIES");
    if (!w?.token) return "unknown";
    const { body: b2 } = await safeFetch(`https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(w.request))}&token=${encodeURIComponent(w.token)}`, "application/json", UA, 500_000, 12_000);
    return trendDirection(parseTrendsTimeline(new TextDecoder().decode(b2)));
  } catch { return "unknown"; }
}

/** Reddit public search (last month). JSON first; when refused, old.reddit.com read through the web ladder (titles only). null = couldn't check. */
export async function redditFor(topic: string): Promise<{ buzz: number; posts: number; via: string } | null> {
  const q = encodeURIComponent(topic);
  try {
    const { res, body } = await safeFetch(`https://www.reddit.com/search.json?q=${q}&sort=top&t=month&limit=25`, "application/json", "orbit-research/1.0 (personal, read-only)", 1_000_000, 12_000);
    if (res.ok) { const posts = parseRedditSearch(JSON.parse(new TextDecoder().decode(body))); return { buzz: redditBuzz(posts), posts: posts.length, via: "reddit json" }; }
  } catch { /* fall through to the ladder */ }
  try {
    const { page } = await ladderRead(`https://old.reddit.com/search?q=${q}&sort=top&t=month`, { maxChars: 6000, lookup: newLookup() });
    if (!page) return null;
    const posts = page.links.filter((l) => /\/r\/\w+\/comments\//.test(l.url) && l.text.length > 15);
    return { buzz: Math.round(Math.log10(1 + posts.length) * 30) / 10, posts: posts.length, via: `web ladder (${page.via})` };
  } catch { return null; }
}

/** Optional free YouTube Data API: exact upload times for a shortlist (1 unit per 50 ids, the manual share). */
async function apiDates(ids: string[]): Promise<Map<string, string>> {
  const key = process.env.YOUTUBE_API_KEY?.trim(), out = new Map<string, string>();
  if (!key || !ids.length) return out;
  try {
    await withYoutubeBudget("yt-autopilot", "manual", async () => {
      const r = await api<{ items?: { id?: string; snippet?: { publishedAt?: string } }[] }>("videos", { part: "snippet", id: ids.slice(0, 50).join(",") }, key);
      for (const v of r.items ?? []) if (v.id && v.snippet?.publishedAt) out.set(v.id, v.snippet.publishedAt);
    });
  } catch { /* quota or key problem: yt-dlp's dates stay */ }
  return out;
}

export type OutlierWhy = Evidence & { thumbUrl: string; url: string; why: Why; whyBy: "claude" | "rules" };
export type ClusterOut = { label: string; videos: number; weight: number; trend: Direction; reddit: { buzz: number; posts: number; via: string } | null; titles: string[] };
export type Report = {
  niche: string; at: string; queries: string[]; searched: number; channels: number; scored: number; outliers: OutlierWhy[]; clusters: ClusterOut[]; lifts: Lift[];
  sources: { name: string; ok: boolean; note: string }[]; calls: number;
};
export type Step = (label: string, now: string) => void;

/** One full research run. Bounded: ≤ 4 searches, ≤ 15 channels (2 tabs each), detail reads for ~3× the top, ≤ 40 yt-dlp calls. */
export async function runResearch(inp: ResearchInput, step: Step = () => {}, signal?: AbortSignal): Promise<Report> {
  const run: Run = { calls: 0, last: 0, signal, log: [] }, now = Date.now(), sources: Report["sources"] = [];
  step("Searching YouTube", `Searching "${inp.queries[0]}"`);
  const cands: YtVideo[] = [];
  for (const q of inp.queries) {
    try { cands.push(...(await search(run, q, inp.perQuery))); }
    catch (e) { if (!cands.length && q === inp.queries.at(-1)) throw e; run.log.push(`search "${q}": ${(e as Error).message}`); }
  }
  if (!cands.length) throw new ResearchError("YouTube search gave nothing back");
  const off = cands.length;
  cands.splice(0, cands.length, ...cands.filter((c) => onNiche(c.title, inp.niche)));
  if (!cands.length) throw new ResearchError(`None of the ${off} search results were about "${inp.niche}"`);
  sources.push({ name: "YouTube search (yt-dlp)", ok: true, note: `${cands.length} on-topic videos from ${inp.queries.length} searches (${off - cands.length} off-topic dropped)` });

  const ids = channelsToRead(cands, inp.maxChannels), channels = new Map<string, ChannelTab>();
  for (const [k, id] of ids.entries()) {
    step("Reading channels", `Channel ${k + 1} of ${ids.length}: what's normal for them`);
    try { const t = await channelTab(run, id); if (t) channels.set(id, t); } catch (e) { if (/call cap|Stop-all|cancelled/.test((e as Error).message)) break; }
  }
  sources.push({ name: "Channel baselines (yt-dlp)", ok: channels.size > 0, note: `${channels.size} of ${ids.length} channels read` });

  // Pass 1 without dates (search results have none) → shortlist → exact dates + details → pass 2.
  step("Finding outliers", "Comparing every video with its own channel");
  let ranked = rankOutliers(cands, channels, now);
  const short = ranked.filter((r) => r.outlier || r.projected !== null).slice(0, inp.top * 3);
  const dates = await apiDates(short.map((s) => s.id));
  const details = new Map<string, VideoDetail>();
  for (const [k, s] of short.entries()) {
    step("Finding outliers", `Checking details ${k + 1} of ${short.length}`);
    try { const d = await detail(run, s.id); if (d) details.set(s.id, d); } catch (e) { if (/call cap|Stop-all|cancelled/.test((e as Error).message)) break; }
  }
  const dated = cands.map((c) => { const d = details.get(c.id); return { ...c, ...(d && { views: d.views, isShort: d.isShort, durationSec: d.durationSec, uploadedAt: d.uploadedAt }), ...(dates.has(c.id) && { uploadedAt: dates.get(c.id)! }) }; });
  ranked = rankOutliers(dated, channels, now);
  const winners = ranked.filter((r) => r.outlier && details.has(r.id));
  sources.push({ name: "Video details (yt-dlp)", ok: details.size > 0, note: `${details.size} videos${dates.size ? `, ${dates.size} exact dates from the YouTube API` : ""}` });

  const stop = nicheStop(inp.niche);
  const clusters = clusterTitles(ranked.filter((r) => r.outlier), (r) => r.title, (r) => r.score, { stop });
  const clusterOf = new Map(clusters.flatMap((c) => c.items.map((i) => [i.id, c.label] as const)));
  const others = ranked.filter((r) => !r.outlier && r.projected !== null).map((r) => r.title);
  const lifts = featureLift(ranked.filter((r) => r.outlier).map((r) => r.title), others);

  const outliers: OutlierWhy[] = [];
  let claudeOk = 0, capsOk = 0, thumbsOk = 0;
  for (const [k, w] of winners.slice(0, inp.top).entries()) {
    step("Working out why", `Video ${k + 1} of ${Math.min(inp.top, winners.length)}: title, thumbnail, first 30 s, pacing`);
    const d = details.get(w.id)!, cues = await captions(d), thumb = await thumbTraits(d, signal);
    if (cues.length) capsOk++;
    if (thumb) thumbsOk++;
    const f = titleFeatures(w.title);
    const ev: Evidence = { id: w.id, title: w.title, channel: w.channel, views: w.views, projected: w.projected, basis: w.basis, age: w.age, isShort: w.isShort,
      features: (Object.keys(f) as TitleFeature[]).filter((x) => f[x]), thumb, hook: hookText(cues, 30), pacing: pacing(d, cues), posted: postingTime(d.uploadedAt, d.exactTime), cluster: clusterOf.get(w.id) ?? "" };
    let why: Why | null = null;
    try { why = validWhy(jsonObject((await askClaude(whyPrompt(ev, lifts), WHY_SYSTEM, { model: MODEL, signal, purpose: "yt-autopilot why", timeoutMs: 120_000 })).text)); } catch { why = null; }
    if (why) claudeOk++;
    outliers.push({ ...ev, thumbUrl: d.thumb, url: `https://www.youtube.com/${w.isShort ? "shorts/" : "watch?v="}${w.id}`, why: why ?? fallbackWhy(ev, lifts), whyBy: why ? "claude" : "rules" });
  }
  sources.push({ name: "Public captions (first 30 s)", ok: capsOk > 0, note: `${capsOk} of ${outliers.length}` });
  sources.push({ name: "Thumbnail look (Claude vision)", ok: thumbsOk > 0, note: `${thumbsOk} of ${outliers.length}` });
  sources.push({ name: "Why (Claude)", ok: claudeOk > 0, note: claudeOk === outliers.length ? "all" : `${claudeOk} of ${outliers.length}; the rest from plain rules` });

  step("Cross-checking", "Google Trends and Reddit for the top topics");
  const top = clusters.slice(0, 3), outC: ClusterOut[] = [];
  for (const c of clusters.slice(0, 6)) {
    const q = `${inp.niche.replace(/\bexplainers?\b/i, "").trim()} ${c.terms.slice(0, 2).join(" ")}`.trim();
    const checked = top.includes(c);
    outC.push({ label: c.label, videos: c.items.length, weight: Math.round(c.weight * 10) / 10, trend: checked ? await trendsFor(q) : "unknown", reddit: checked ? await redditFor(q) : null, titles: c.items.slice(0, 3).map((i) => i.title) });
  }
  sources.push({ name: "Google Trends", ok: outC.some((c) => c.trend !== "unknown"), note: outC.some((c) => c.trend !== "unknown") ? "checked" : "Google refused or had too little data" });
  sources.push({ name: "Reddit", ok: outC.some((c) => c.reddit), note: outC.find((c) => c.reddit)?.reddit?.via ?? "Reddit refused (it blocks many IPs)" });

  return { niche: inp.niche, at: new Date(now).toISOString(), queries: inp.queries, searched: cands.length, channels: channels.size, scored: ranked.filter((r) => r.projected !== null).length,
    outliers, clusters: outC, lifts, sources, calls: run.calls };
}
export type { Scored };
