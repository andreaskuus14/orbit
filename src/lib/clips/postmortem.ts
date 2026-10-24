import { access } from "node:fs/promises";
import path from "node:path";
import { emitAsOwner } from "../claude";
import { analyzeRetention } from "../retention-pure";
import { getAnalyticsReport } from "../yt-analytics";
import { YT_SCOPES, hasScopes } from "../yt-analytics-pure";
import { OAuthError, oauthEnv, readStored } from "../yt-oauth";
import { getJob, loadAnalysis, readState, saveState, studioRoot } from "./factory";
import { learnProblem, type LearnState } from "./learn-pure";
import {
  addPostmortems, buildPostMortem, pmLine, clipTranscript, decideRule, emptyPostmortem, postmortemDue, postmortemProblem, retentionPoints,
  type PostMortem, type PostMortemState, type PostMortemView,
} from "./postmortem-pure";

// Retention post-mortems: <studio>/postmortem.json. Run from the results loop (learn.ts, every 15 min; work only when a Short is due).
// One Analytics report per due Short (0 Data API units in ORBIT's budget). Pure logic: postmortem-pure.ts.

const file = () => path.join(studioRoot(), "postmortem.json");
const g = globalThis as unknown as { __orbitPostmortem?: Promise<unknown> };
const read = () => readState<PostMortemState>(studioRoot(), "postmortem", postmortemProblem);

/** Serialised read-modify-write; a locked/unreadable file is never reset to empty. */
function update<T>(fn: (s: PostMortemState) => Promise<{ next: PostMortemState | null; out: T }>): Promise<T> {
  const p = (g.__orbitPostmortem ?? Promise.resolve()).then(async () => {
    const s = await read();
    if (!s && await access(file()).then(() => true, () => false)) throw new Error("postmortem.json is unreadable (locked?), try later");
    const { next, out } = await fn(s ?? emptyPostmortem());
    if (next) await saveState("postmortem", file(), next);
    return out;
  });
  g.__orbitPostmortem = p.catch(() => {});
  return p;
}

/** The saved state, each post-mortem with its ready-made STUDIO line. */
export async function postmortemView(): Promise<PostMortemView> {
  const s = (await read()) ?? emptyPostmortem();
  return { ...s, items: s.items.map((p) => ({ ...p, line: pmLine(p) })) };
}

async function transcriptFor(jobId: string, clipId: string) {
  const [job, a] = await Promise.all([getJob(jobId), loadAnalysis(jobId)]);
  const clip = job?.clips.find((c) => c.id === clipId);
  return clip && a ? { transcript: clipTranscript(a.words, clip.start, clip.end), hook: clip.hook } : null;
}

export async function runPostmortems(now = Date.now()) {
  const made = await update(async (s): Promise<{ next: PostMortemState | null; out: (PostMortem & { clipId: string })[] }> => {
    const learn = await readState<LearnState>(studioRoot(), "learn", learnProblem);
    const recs = Object.values(learn?.clips ?? {});
    const due = postmortemDue(recs.map((r) => ({ videoId: r.videoId, title: r.title, publishedAt: r.publishedAt, durationSec: r.durationSec })), s, now);
    if (!due.length) return { next: null, out: [] };
    const at = new Date(now).toISOString();
    const stored = oauthEnv() ? await readStored() : null;
    // Not connected: keep the Shorts due (no tries spent) and say why in STUDIO.
    if (!stored || !hasScopes(stored.scope, [YT_SCOPES[0]])) {
      const status = `${due.length} post-mortem${due.length > 1 ? "s" : ""} waiting: connect YouTube (Analytics) in STUDIO`;
      return { next: s.status === status ? null : { ...s, status, checkedAt: at }, out: [] };
    }
    const made: (PostMortem & { clipId: string })[] = [], tries = { ...s.tries };
    let status = "";
    for (const d of due) {
      const rec = recs.find((r) => r.videoId === d.videoId)!;
      try {
        const rows = await getAnalyticsReport(stored, { start: (d.publishedAt ?? at).slice(0, 10), end: at.slice(0, 10), dimensions: "elapsedVideoTimeRatio",
          metrics: "audienceWatchRatio,relativeRetentionPerformance", filters: `video==${d.videoId}` });
        const extra = await transcriptFor(rec.jobId, rec.clipId).catch(() => null);
        const report = analyzeRetention({ duration: d.durationSec, points: retentionPoints(rows), transcript: extra?.transcript,
          beats: extra?.hook ? [{ start: 0, end: Math.min(3, d.durationSec), label: `Hook "${extra.hook.slice(0, 60)}"` }] : undefined });
        const pm = buildPostMortem(d, report, at);
        if (pm) { made.push({ ...pm, clipId: `${rec.jobId}/${rec.clipId}` }); delete tries[d.videoId]; } else tries[d.videoId] = { n: (tries[d.videoId]?.n ?? 0) + 1, at };
      } catch (e) {
        if (e instanceof OAuthError && e.message === "invalid_grant") { status = "YouTube sign-in expired: reconnect it in STUDIO for post-mortems"; break; }
        tries[d.videoId] = { n: (tries[d.videoId]?.n ?? 0) + 1, at };
        status = `Post-mortem: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      }
    }
    return { next: { ...s, status, checkedAt: at, tries, items: addPostmortems(s, made.map(({ clipId: _, ...p }) => p)) }, out: made };
  });
  // After the save, so a failed save can't log it twice.
  for (const p of made) void emitAsOwner("clip.postmortem", "studio", { clipId: p.clipId, drops: p.drops.length, ...(p.hold3s !== null && { hold3s: p.hold3s }) });
  return made.length;
}

/** The owner's click on a proposed rule. false = no open proposal for that video. */
export const decidePostmortem = (videoId: string, action: "accept" | "dismiss") => update(async (s) => {
  const next = decideRule(s, videoId, action, new Date().toISOString());
  return { next, out: !!next };
});
