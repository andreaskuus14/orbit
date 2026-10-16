import { access } from "node:fs/promises";
import path from "node:path";
import { api } from "../youtube";
import { getAnalyticsReport } from "../yt-analytics";
import { YT_SCOPES, hasScopes } from "../yt-analytics-pure";
import { readStored } from "../yt-oauth";
import { listJobs, readState, saveState, studioRoot } from "./factory";
import { applyStats, emptyLearn, formatTaste, insights, learnDue, learnProblem, syncRecords, type Insights, type LearnState, type Stats } from "./learn-pure";

// Learning loop: <studio>/learn.json holds published clips' stats (24h/72h/7d snapshots); review decisions come from the job files.
// Refreshed lazily from GET /api/studio/clips/learn, at most once per 6 h. Analysis: learn-pure.ts.

const file = () => path.join(studioRoot(), "learn.json");
const g = globalThis as unknown as { __orbitLearn?: { running?: Promise<void>; notes?: { at: number; text: string } } };
const L = (g.__orbitLearn ??= {});

const load = async () => (await readState<LearnState>(studioRoot(), "learn", learnProblem)) ?? emptyLearn();

type VideoItem = { id: string; snippet?: { publishedAt?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };
const num = (s: unknown) => (Number.isFinite(Number(s)) ? Number(s) : 0);

async function collect() {
  const s = await readState<LearnState>(studioRoot(), "learn", learnProblem) ?? emptyLearn();
  // null + file still there = locked/unreadable (a damaged one is moved aside): rebuilding from empty would wipe the stats history
  if (!s.checkedAt && await access(file()).then(() => true, () => false)) throw new Error("learn.json is unreadable (locked by another program?), try later");
  const now = Date.now(), at = new Date(now).toISOString(), warnings: string[] = [];
  s.clips = syncRecords(await listJobs(), s.clips);
  const ids = Object.keys(s.clips);
  const stats = new Map<string, { st: Stats; pub?: string }>();
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (ids.length && !key) warnings.push("Set YOUTUBE_API_KEY to collect views of published clips");
  else if (ids.length && key) {
    for (let i = 0; i < ids.length; i += 50) { // 1 quota unit per 50 videos
      try {
        const r = await api<{ items?: VideoItem[] }>("videos", { part: "snippet,statistics", id: ids.slice(i, i + 50).join(",") }, key);
        for (const v of r.items ?? []) stats.set(v.id, { pub: v.snippet?.publishedAt,
          st: { at, views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) } });
      } catch (e) { warnings.push(`Views: ${e instanceof Error ? e.message : e}`); }
    }
    const hidden = ids.filter((id) => !stats.has(id) && !s.clips[id].latest).length; // private/scheduled videos aren't visible to an API key
    if (hidden) warnings.push(`${hidden} published clip${hidden > 1 ? "s are" : " is"} private or scheduled: no stats until public`);
    const stored = await readStored();
    if (stats.size && stored && hasScopes(stored.scope, [YT_SCOPES[0]])) {
      const seen = [...stats.keys()];
      const start = [...stats.values()].map((x) => x.pub?.slice(0, 10) ?? at.slice(0, 10)).sort()[0];
      for (let i = 0; i < seen.length; i += 50) {
        try {
          const rows = await getAnalyticsReport(stored, { start, end: at.slice(0, 10), metrics: "views,averageViewPercentage,averageViewDuration,subscribersGained",
            dimensions: "video", filters: `video==${seen.slice(i, i + 50).join(",")}`, sort: "-views", maxResults: 50 });
          for (const r of rows) {
            const x = stats.get(String(r.video));
            if (x) Object.assign(x.st, { avgViewPct: Math.round(num(r.averageViewPercentage) * 10) / 10, avgViewSec: num(r.averageViewDuration), subs: num(r.subscribersGained) });
          }
        } catch (e) { warnings.push(`Retention (Analytics): ${e instanceof Error ? e.message : e}`); }
      }
    } else if (stats.size) warnings.push("Connect YouTube (Analytics) to learn from retention too");
  }
  for (const [id, x] of stats) s.clips[id] = applyStats(s.clips[id], x.st, x.pub, now);
  Object.assign(s, { checkedAt: at, warnings }); // stamped even on failure: at most one try per 6 h protects the quota
  await saveState("learn", file(), s);
  L.notes = undefined;
}

/** Collects stats if 6 h have passed (one run at a time), then the analysis for the UI. */
export async function learnView(): Promise<Insights> {
  let err = "";
  if (learnDue(await load(), Date.now())) await (L.running ??= collect().finally(() => { L.running = undefined; })).catch((e) => { err = e instanceof Error ? e.message : String(e); });
  const i = insights(await load(), await listJobs());
  return err ? { ...i, warnings: [err, ...i.warnings] } : i;
}

/** Plain-text brief of the owner's taste for clip-picking prompts (≤ 1200 chars, "" with no data). Cached 1 min: a job asks up to 3 times. */
export async function tasteNotes(): Promise<string> {
  if (L.notes && Date.now() - L.notes.at < 60_000) return L.notes.text;
  const text = formatTaste(insights(await load(), await listJobs()));
  L.notes = { at: Date.now(), text };
  return text;
}

/** tasteNotes() as a prompt section, or "" (never throws: picking must work without it). */
export const tastePrompt = () => tasteNotes().then((t) => (t ? `\n\nOwner's taste, learned from his past reviews and channel stats (a strong hint, not a hard rule):\n${t}` : ""), () => "");
