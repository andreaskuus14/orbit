// STUDIO Shorts pipeline board (Clip Factory → Pipeline): pure stage derivation, weekly target math and the owner's CTR history
// for the packaging scorer. Derived only from data ORBIT already keeps (Idea Radar, AI Story, clip jobs, publish state). Tested in tests/pipeline.test.ts.
import type { PackagingHistory } from "../packaging-pure.ts";
import { isShort } from "../youtube-pure.ts";
import { fenceUntrusted } from "../reach/pure.ts";

export const STAGES = ["idea", "script", "clip", "package", "review", "scheduled"] as const;
export type Stage = (typeof STAGES)[number];
export const DEFAULT_WEEKLY_TARGET = 7;
const DAY = 86_400_000;

// Structural mirrors of ideas-pure Idea, story-pure StoryJob and clips/types ClipJob: only the fields read here.
export type PIdea = { id: string; title: string; summary: string; area: string; score: number; dismissed?: boolean; untrusted?: true; origin?: string };
export type PStory = { id: string; createdAt: string; status: "draft" | "quoted" | "generating" | "assembling" | "done" | "failed"; step: string; opts: { idea: string }; story: { title: string }; clipJob?: string };
export type PPublish = { status: "uploading" | "done" | "scheduled" | "failed" | "unknown"; at: string; scheduledFor?: string };
export type PClip = { id: string; title: string; status: "rendering" | "ready" | "failed" | "approved" | "rejected"; score: number;
  titleOptions?: { text: string }[]; thumbOptions?: string[]; critic?: unknown; publish?: PPublish };
export type PJob = { id: string; source: string; status: string; step: string; progress: number; clips: PClip[] };

/** What a card opens: the existing tool for its stage. */
export type Open =
  | { tool: "story"; idea: string } | { tool: "story"; story: string }
  | { tool: "clip"; job: string; clip?: string } | { tool: "review" } | { tool: "calendar" };
export type Card = { key: string; stage: Stage; title: string; note: string; score?: number; at?: number; warn?: boolean; open: Open;
  pack?: { job: string; clip: string; titles: string[] } }; // package stage: the clip's title candidates for the packaging scorer

/** The idea text an Idea Radar idea seeds AI Story with; also how a written story is matched back to its idea. */
export const ideaSeed = (i: Partial<Pick<PIdea, "title" | "summary" | "untrusted" | "origin">> & { title: string; summary: string }) => `${i.title.trim()}: ${i.untrusted || i.origin === "outliers" ? fenceUntrusted("YouTube video text", i.summary.trim(), 400) : i.summary.trim()}`.slice(0, 1000); // third-party text goes to AI Story fenced as data; ideas saved before #552 have origin "outliers" without the flag
const ms = (s?: string) => (s ? Date.parse(s) : NaN);
/** When a Short goes (or went) live: the scheduled time, else the upload time. */
export const liveAt = (p: PPublish) => (Number.isFinite(ms(p.scheduledFor)) ? ms(p.scheduledFor) : ms(p.at));
const WORKING_JOB = new Set(["queued", "probing", "transcribing", "finding", "rendering"]);

/** Current, title + up to 4 options, deduplicated: 2–5 candidates when the clip has any options. */
export function clipTitles(c: Pick<PClip, "title" | "titleOptions">): string[] {
  return [...new Set([c.title, ...(c.titleOptions ?? []).map((o) => o.text)].map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 5);
}

/** Packaging is open while there is something to A/B (≥2 titles or thumbnails) and the title critics haven't reviewed it yet. */
export const needsPackaging = (c: PClip) => !c.critic && (clipTitles(c).length >= 2 || (c.thumbOptions?.length ?? 0) >= 2);

function clipCard(job: PJob, c: PClip, weekStart: number): Card | null {
  const base = { key: `clip:${job.id}/${c.id}`, title: c.title, score: c.score };
  const p = c.publish;
  if (p && p.status !== "failed") {
    const at = liveAt(p);
    if (p.status === "done" && !(at >= weekStart)) return null; // published before this week: off the board
    const note = p.status === "scheduled" ? "Scheduled" : p.status === "done" ? "Published" : p.status === "uploading" ? "Uploading" : "Upload unclear: check";
    return { ...base, stage: "scheduled", note, at: Number.isFinite(at) ? at : undefined, warn: p.status === "unknown", open: { tool: "calendar" } };
  }
  if (c.status === "rejected") return null;
  if (c.status === "rendering" || c.status === "failed") return { ...base, stage: "clip", note: c.status === "failed" ? "Render failed" : "Rendering", warn: c.status === "failed", open: { tool: "clip", job: job.id, clip: c.id } };
  if (c.status === "approved") return { ...base, stage: "review", note: p ? "Upload failed: pick a slot again" : "Approved: pick a slot", warn: !!p, open: { tool: "clip", job: job.id, clip: c.id } };
  if (needsPackaging(c)) return { ...base, stage: "package", note: `${clipTitles(c).length} titles · ${c.thumbOptions?.length ?? 1} thumbs`, open: { tool: "clip", job: job.id, clip: c.id },
    pack: { job: job.id, clip: c.id, titles: clipTitles(c) } };
  return { ...base, stage: "review", note: "Ready to review", open: { tool: "review" } };
}

/** Every Short in flight, one card each, in stage order; within a stage the strongest (or soonest live) first. */
export function pipelineCards(input: { ideas: PIdea[]; stories: PStory[]; jobs: PJob[] }, weekStart: number): Card[] {
  const out: Card[] = [];
  const written = new Set(input.stories.map((s) => s.opts.idea.trim()));
  for (const i of input.ideas) if (i.area === "studio" && !i.dismissed && !written.has(ideaSeed(i)))
    out.push({ key: `idea:${i.id}`, stage: "idea", title: i.title, note: i.summary, score: i.score / 100, open: { tool: "story", idea: ideaSeed(i) } });
  for (const s of input.stories) {
    if (s.status === "done") continue; // its Short is a clip job now (or was removed)
    const making = s.status === "generating" || s.status === "assembling";
    out.push({ key: `story:${s.id}`, stage: making ? "clip" : "script", title: s.story.title || s.opts.idea, warn: s.status === "failed",
      note: s.status === "draft" ? "Script written: edit or price it" : s.status === "quoted" ? "Priced: approve to generate" : s.status === "failed" ? "Story failed" : s.step || "Generating",
      at: ms(s.createdAt), open: { tool: "story", story: s.id } });
  }
  for (const j of input.jobs) {
    if (WORKING_JOB.has(j.status) && !j.clips.length) out.push({ key: `job:${j.id}`, stage: "clip", title: j.source, note: `${j.step || j.status} · ${Math.round(Math.min(1, Math.max(0, j.progress || 0)) * 100)}%`, open: { tool: "clip", job: j.id } });
    for (const c of j.clips) { const card = clipCard(j, c, weekStart); if (card) out.push(card); }
  }
  const order = (c: Card) => STAGES.indexOf(c.stage);
  return out.sort((a, b) => order(a) - order(b) || (a.stage === "scheduled" ? (a.at ?? Infinity) - (b.at ?? Infinity) : (b.score ?? 0) - (a.score ?? 0)) || a.key.localeCompare(b.key));
}

/** Monday 00:00 local time of the week containing `now`. */
export function weekStartOf(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export const validTarget = (x: unknown) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= 1 && n <= 50 ? n : DEFAULT_WEEKLY_TARGET; };

/** Shorts booked live this week (scheduled, uploading or published inside Mon–Sun) against the weekly target.
 * expected: how many should be booked by now at an even pace; ready: approved/reviewable clips that could fill the gap. */
export function weekProgress(jobs: PJob[], now: number, target: number) {
  const start = weekStartOf(now), end = start + 7 * DAY, goal = validTarget(target);
  let booked = 0, ready = 0;
  for (const j of jobs) for (const c of j.clips) {
    const p = c.publish;
    if (p && p.status !== "failed") { const at = liveAt(p); if (at >= start && at < end) booked++; }
    else if (c.status === "approved" || c.status === "ready") ready++;
  }
  const expected = Math.floor(goal * Math.min(1, Math.max(0, (now - start) / (7 * DAY))));
  return { start, booked, target: goal, left: Math.max(0, goal - booked), pct: Math.min(100, Math.round((booked / goal) * 100)), expected, behind: booked < expected, ready };
}

/** YouTube may report the click rate as a percent or a fraction: a column with any value > 1, or a median above 30%, is percent. */
export function ctrScale(rates: number[]): number {
  const xs = rates.filter((r) => Number.isFinite(r) && r >= 0).sort((a, b) => a - b);
  if (!xs.length) return 1;
  return xs[xs.length - 1] > 1 || xs[Math.floor(xs.length / 2)] > 0.3 ? 0.01 : 1;
}

/** Analytics rows (dimension video: videoThumbnailImpressions, videoThumbnailImpressionsClickRate, averageViewPercentage) joined with
 * the channel's public video list for title, date and format. Rows without a known video or impressions are dropped. */
export function packagingHistoryFrom(rows: Record<string, string | number>[], videos: { id: string; title: string; publishedAt: string; durationSec: number }[]): PackagingHistory[] {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const scale = ctrScale(rows.map((r) => num(r.videoThumbnailImpressionsClickRate)));
  return rows.flatMap((r) => {
    const v = byId.get(String(r.video)), impressions = num(r.videoThumbnailImpressions), ctr = num(r.videoThumbnailImpressionsClickRate) * scale, avg = num(r.averageViewPercentage);
    if (!v || !(impressions > 0) || !(ctr >= 0 && ctr <= 1)) return [];
    return [{ title: v.title, ctr, impressions, avgViewPct: Number.isFinite(avg) && avg >= 0 ? avg : 0, publishedAt: v.publishedAt, isShort: isShort(v) }];
  });
}
