import { randomUUID } from "node:crypto";
import path from "node:path";
import { readState, saveState, studioRoot } from "./clips/factory";
import { learnProblem, type LearnState } from "./clips/learn-pure";
import { COMMENT_IDEAS_EVERY_MS, clusterComments, mergeCommentIdeas, parseThreads, type RawComment } from "./comment-ideas-pure";
import { updateIdeas } from "./ideas";
import { api } from "./youtube";
import { withYoutubeBudget } from "./youtube-quota";

// Comment-to-idea: once a day (results loop, learn.ts) read the comments on his Shorts from the last 14 days (commentThreads.list,
// read-only, 1 quota unit per video, at most 10 per run, scout share), cluster recurring questions and save clusters with 3+ askers
// as IDEA RADAR ideas. Never replies. State: <studio>/comment-ideas.json. Pure logic: comment-ideas-pure.ts.

type State = { v: 1; checkedAt: string; status: string; added: number };
const problem = (x: unknown) => (x as State)?.v === 1 && typeof (x as State).checkedAt === "string" ? "" : "not a comment-ideas state";
const RECENT_MS = 14 * 86_400_000, MAX_VIDEOS = 10;

export const commentIdeasView = () => readState<State>(studioRoot(), "comment-ideas", problem);

export async function runCommentIdeas(now = Date.now()): Promise<void> {
  const prev = await commentIdeasView();
  if (prev && now - Date.parse(prev.checkedAt) < COMMENT_IDEAS_EVERY_MS) return;
  const learn = await readState<LearnState>(studioRoot(), "learn", learnProblem);
  const videos = Object.values(learn?.clips ?? {}).filter((r) => now - Date.parse(r.publishedAt ?? "") < RECENT_MS)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, MAX_VIDEOS);
  const key = process.env.YOUTUBE_API_KEY?.trim();
  let status = "", added = 0;
  if (!videos.length) status = "No Shorts published in the last 14 days";
  else if (!key) status = "Set YOUTUBE_API_KEY to read comments";
  else {
    const comments: RawComment[] = [], errors: string[] = [];
    await withYoutubeBudget("comment-ideas", "scout", async () => {
      for (const v of videos) {
        try {
          comments.push(...parseThreads(await api("commentThreads", { part: "snippet", videoId: v.videoId, maxResults: "100", order: "relevance", textFormat: "plainText" }, key), v.videoId));
        } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); if (/YouTube share|reserve/.test(String(e))) break; } // quota guard tripped: stop
      }
    });
    const clusters = clusterComments(comments);
    if (clusters.length) await updateIdeas((ideas) => { const r = mergeCommentIdeas(ideas, clusters, Object.fromEntries(videos.map((v) => [v.videoId, v.title])), new Date(now).toISOString(), randomUUID); added = r.added; return r.ideas; });
    status = `${comments.length} comments read on ${videos.length} Shorts · ${clusters.length} recurring question${clusters.length === 1 ? "" : "s"}${errors.length ? ` · ${errors.length} failed: ${errors[0]}` : ""}`.slice(0, 300);
  }
  // Stamped even on failure: at most one run a day protects the quota.
  await saveState("comment-ideas", path.join(studioRoot(), "comment-ideas.json"), { v: 1, checkedAt: new Date(now).toISOString(), status, added } satisfies State);
}
