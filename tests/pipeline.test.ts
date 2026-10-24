import { test } from "node:test";
import assert from "node:assert/strict";
import { clipTitles, ctrScale, ideaSeed, packagingHistoryFrom, pipelineCards, validTarget, weekProgress, weekStartOf, type PClip, type PJob } from "../src/lib/clips/pipeline-pure.ts";

const NOW = new Date(2026, 9, 22, 15, 0).getTime(); // Thursday 22 Oct 2026, local time
const WEEK = weekStartOf(NOW);
const clip = (id: string, extra: Partial<PClip> = {}): PClip => ({ id, title: `Clip ${id}`, status: "ready", score: 0.5, ...extra });
const job = (clips: PClip[], extra: Partial<PJob> = {}): PJob => ({ id: "j1", source: "vod.mp4", status: "done", step: "", progress: 1, clips, ...extra });
const iso = (d: number, h = 12) => new Date(2026, 9, d, h).toISOString();

test("week starts Monday 00:00 local, also on a Sunday", () => {
  assert.equal(WEEK, new Date(2026, 9, 19).getTime());
  assert.equal(weekStartOf(new Date(2026, 9, 25, 23, 59).getTime()), WEEK);
  assert.equal(weekStartOf(new Date(2026, 9, 26, 0, 0).getTime()), new Date(2026, 9, 26).getTime());
});

test("each source lands in its stage and opens the tool for it", () => {
  const ideas = [{ id: "i1", title: "Speedrun fail", summary: "the 3 s fall", area: "studio", score: 80 }, { id: "i2", title: "Biz", summary: "x", area: "business", score: 90 },
    { id: "i3", title: "Written", summary: "already", area: "studio", score: 70 }];
  const stories = [
    { id: "s1", createdAt: iso(20), status: "draft" as const, step: "", opts: { idea: "a" }, story: { title: "Draft story" } },
    { id: "s2", createdAt: iso(20), status: "generating" as const, step: "Scene 2/5", opts: { idea: ideaSeed(ideas[2]) }, story: { title: "Making" } },
    { id: "s3", createdAt: iso(20), status: "done" as const, step: "", opts: { idea: "c" }, story: { title: "Done" }, clipJob: "j1" },
  ];
  const jobs = [job([
    clip("render", { status: "rendering" }),
    clip("ab", { titleOptions: [{ text: "Clip ab" }, { text: "Other" }] }),
    clip("reviewed", { titleOptions: [{ text: "A" }, { text: "B" }], critic: {} }),
    clip("approved", { status: "approved" }),
    clip("sched", { status: "approved", publish: { status: "scheduled", at: iso(20), scheduledFor: iso(24) } }),
    clip("old", { status: "approved", publish: { status: "done", at: iso(10) } }),
    clip("gone", { status: "rejected" }),
  ]), job([], { id: "j2", status: "transcribing", step: "Transcribing", progress: 0.42 })];
  const cards = pipelineCards({ ideas, stories, jobs }, WEEK);
  const at = (key: string) => cards.find((c) => c.key === key);
  assert.deepEqual(cards.map((c) => c.stage), ["idea", "script", "clip", "clip", "clip", "package", "review", "review", "scheduled"]);
  assert.deepEqual(at("idea:i1")?.open, { tool: "story", idea: "Speedrun fail: the 3 s fall" });
  assert.equal(at("idea:i3"), undefined); // a story was written from it
  assert.deepEqual(at("story:s1")?.open, { tool: "story", story: "s1" });
  assert.equal(at("story:s2")?.stage, "clip");
  assert.equal(at("job:j2")?.note, "Transcribing · 42%");
  assert.deepEqual(at("clip:j1/ab")?.pack, { job: "j1", clip: "ab", titles: ["Clip ab", "Other"] });
  assert.deepEqual(at("clip:j1/reviewed")?.open, { tool: "review" });
  assert.deepEqual(at("clip:j1/approved")?.open, { tool: "clip", job: "j1", clip: "approved" });
  assert.equal(at("clip:j1/old"), undefined);
});

test("title candidates are deduplicated and capped at 5", () => {
  assert.deepEqual(clipTitles({ title: " A  b ", titleOptions: ["A b", "C", "D", "E", "F", "G"].map((text) => ({ text })) }), ["A b", "C", "D", "E", "F"]);
});

test("weekly progress counts Shorts booked live this week against the target", () => {
  const jobs = [job([
    clip("a", { status: "approved", publish: { status: "done", at: iso(19, 9) } }),
    clip("b", { status: "approved", publish: { status: "scheduled", at: iso(21), scheduledFor: iso(25, 21) } }),
    clip("c", { status: "approved", publish: { status: "scheduled", at: iso(21), scheduledFor: iso(26, 12) } }), // next week
    clip("d", { status: "approved", publish: { status: "failed", at: iso(21) } }),
    clip("e", { status: "ready" }),
  ])];
  const w = weekProgress(jobs, NOW, 7);
  assert.equal(w.booked, 2); assert.equal(w.left, 5); assert.equal(w.pct, 29); assert.equal(w.ready, 2);
  assert.equal(w.expected, 3); assert.equal(w.behind, true); // Thursday 15:00 ≈ 3.6 days in
  assert.equal(weekProgress(jobs, NOW, 1).pct, 100);
  assert.equal(validTarget("0"), 7); assert.equal(validTarget(12.4), 12); assert.equal(validTarget("abc"), 7);
});

test("CTR history: percent or fraction columns, joined with titles and format", () => {
  assert.equal(ctrScale([4.2, 6.1, 0.8]), 0.01);
  assert.equal(ctrScale([0.042, 0.061]), 1);
  assert.equal(ctrScale([0.5, 0.6, 0.7]), 0.01); // a 50%+ median CTR is a percent column under 1%
  const videos = [{ id: "aaaaaaaaaaa", title: "Long one", publishedAt: "2026-01-01T00:00:00Z", durationSec: 600 }, { id: "bbbbbbbbbbb", title: "Short one", publishedAt: "2026-02-01T00:00:00Z", durationSec: 30 }];
  const h = packagingHistoryFrom([
    { video: "aaaaaaaaaaa", videoThumbnailImpressions: 1000, videoThumbnailImpressionsClickRate: 5, averageViewPercentage: 40 },
    { video: "bbbbbbbbbbb", videoThumbnailImpressions: "200", videoThumbnailImpressionsClickRate: "2.5", averageViewPercentage: 90 },
    { video: "ccccccccccc", videoThumbnailImpressions: 50, videoThumbnailImpressionsClickRate: 3, averageViewPercentage: 10 },
    { video: "aaaaaaaaaaa", videoThumbnailImpressions: 0, videoThumbnailImpressionsClickRate: 3, averageViewPercentage: 10 },
  ], videos);
  assert.deepEqual(h, [
    { title: "Long one", ctr: 0.05, impressions: 1000, avgViewPct: 40, publishedAt: "2026-01-01T00:00:00Z", isShort: false },
    { title: "Short one", ctr: 0.025, impressions: 200, avgViewPct: 90, publishedAt: "2026-02-01T00:00:00Z", isShort: true },
  ]);
});
