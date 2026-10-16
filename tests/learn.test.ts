import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_SAMPLE, NOTES_MAX, applyStats, creatorOf, decisions, emptyLearn, formatTaste, hookStyle, insights, learnDue, learnProblem, perfPatterns, scoreClips, syncRecords,
  type Insights, type LearnRec,
} from "../src/lib/clips/learn-pure.ts";
import type { Clip, ClipJob } from "../src/lib/clips/types.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`;
const rec = (i: number, views: number, extra: Partial<LearnRec> = {}): LearnRec => ({ videoId: vid(i), jobId: "j", clipId: `clip-${i}`, title: `t${i}`, hook: "Why did he do that?",
  reason: "", layout: "fit", captions: "karaoke", durationSec: 25, sourceChannel: "Ninja", kind: "other",
  snaps: { "72h": { at: ago(1), views, likes: 0, comments: 0 } }, ...extra });
const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({ id, start: 0, end: 25, title: "t", hook: "Watch this", reason: "", score: 0.5, status: "ready", ...extra });
const job = (clips: Clip[], feedback: ClipJob["feedback"] = [], extra: Partial<ClipJob> = {}): ClipJob => ({ id: "j1", source: "Ninja_-_Big_game_[abcdefghijk].mp4",
  createdAt: ago(100), updatedAt: ago(1), status: "done", progress: 1, step: "", warnings: [], clips, options: { count: 5, maxSec: 45, captions: true }, feedback, ...extra });

test("features: creator from yt-dlp names, hook styles", () => {
  assert.equal(creatorOf("Ninja_-_Big_game_[abcdefghijk].mp4"), "Ninja");
  assert.equal(creatorOf("Some Guy - title [x].mp4"), "Some Guy");
  assert.equal(creatorOf("myvideo.mp4"), "unknown");
  assert.equal(hookStyle("Why did he?"), "question");
  assert.equal(hookStyle("3 kills in 2s"), "number");
  assert.equal(hookStyle("HE LOST IT"), "all caps");
  assert.equal(hookStyle("He lost it!"), "exclamation");
  assert.equal(hookStyle("he lost it"), "statement");
});

test("learnProblem / learnDue", () => {
  assert.equal(learnProblem(emptyLearn()), "");
  assert.notEqual(learnProblem({ v: 1, warnings: [], clips: { bad: {} } }), "");
  assert.notEqual(learnProblem(null), "");
  const s = { ...emptyLearn(), clips: { [vid(1)]: rec(1, 10) } };
  assert.equal(learnProblem(s), "");
  assert.notEqual(learnProblem({ ...s, clips: { [vid(1)]: { ...rec(1, 10), hook: 5 } } }), ""); // non-string text field → quarantined
  assert.notEqual(learnProblem({ ...s, clips: { [vid(1)]: { ...rec(1, 10), kind: undefined } } }), "");
  assert.ok(learnDue(emptyLearn(), NOW));
  assert.ok(!learnDue({ ...emptyLearn(), checkedAt: ago(5) }, NOW));
  assert.ok(learnDue({ ...emptyLearn(), checkedAt: ago(7) }, NOW));
});

test("syncRecords + applyStats: published clips only, milestone snapshots once", () => {
  const j = job([clip("clip-1", { publish: { status: "done", videoId: vid(1), at: ago(80) } }), clip("clip-2", { publish: { status: "failed", at: ago(1) } }),
    clip("clip-3", { publish: { status: "scheduled", videoId: vid(3), at: ago(1) } })]);
  const recs = syncRecords([j], {});
  assert.deepEqual(Object.keys(recs).sort(), [vid(1), vid(3)]); // scheduled uploads are learned too
  assert.equal(recs[vid(1)].sourceChannel, "Ninja");
  let r = applyStats({ ...recs[vid(1)], snaps: {} }, { at: ago(0), views: 100, likes: 1, comments: 0 }, ago(30), NOW);
  assert.deepEqual(Object.keys(r.snaps), ["24h"]);
  r = applyStats(r, { at: ago(0), views: 500, likes: 1, comments: 0 }, undefined, NOW + 50 * 3_600_000);
  assert.equal(r.snaps["24h"]!.views, 100); // kept
  assert.equal(r.snaps["72h"]!.views, 500);
  assert.equal(r.snaps["7d"], undefined);
  // first seen at 200 h: 24h/72h milestones were missed (≥ 2× their age) and stay empty; 7d is within its window
  const late = applyStats({ ...recs[vid(1)], snaps: {} }, { at: ago(0), views: 9000, likes: 0, comments: 0 }, ago(200), NOW);
  assert.deepEqual(Object.keys(late.snaps), ["7d"]);
});

test("scoreClips: views ÷ channel median, retention weight, needs a 72h snapshot", () => {
  const s = scoreClips([rec(1, 100), rec(2, 200), rec(3, 400), { ...rec(4, 0), snaps: {} }]);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.score), [2, 1, 0.5]);
  const w = scoreClips([rec(1, 100, { latest: { at: "", views: 0, likes: 0, comments: 0, avgViewPct: 80 } }), rec(2, 100, { latest: { at: "", views: 0, likes: 0, comments: 0, avgViewPct: 20 } })]);
  assert.ok(w[0].score > w[1].score && w[0].rec.videoId === vid(1));
});

test("perfPatterns: needs MIN_SAMPLE per bucket", () => {
  const recs = [1, 2, 3].map((i) => rec(i, 1000, { layout: "fill" })).concat([4, 5, 6].map((i) => rec(i, 100, { layout: "split" })), [rec(7, 400, { layout: "fit" })]);
  const p = perfPatterns(scoreClips(recs));
  assert.ok(p.over.some((b) => b.dim === "layout" && b.label === "fill" && b.n === 3));
  assert.ok(p.under.some((b) => b.dim === "layout" && b.label === "split"));
  assert.ok(![...p.over, ...p.under].some((b) => b.label === "fit")); // only 1 clip
  assert.ok(![...p.over, ...p.under].some((b) => b.dim === "creator")); // every clip: says nothing
  assert.deepEqual(insights({ ...emptyLearn(), clips: { [vid(1)]: rec(1, 5), [vid(2)]: rec(2, 9) } }, []).over, []); // < MIN_SAMPLE scored
});

test("decisions: latest verdict per clip, reasons need MIN_SAMPLE, version edits", () => {
  const clips = [1, 2, 3, 4, 5, 6].map((i) => clip(`clip-${i}`, { hook: i <= 3 ? "Why though?" : "ok then", end: i <= 3 ? 25 : 50 }));
  const fb: ClipJob["feedback"] = [
    { clipId: "clip-1", action: "rejected", reason: "boring", at: ago(5) }, { clipId: "clip-1", action: "approved", at: ago(4) }, // changed mind
    { clipId: "clip-2", action: "published", at: ago(4) }, { clipId: "clip-3", action: "approved", at: ago(4) },
    ...[4, 5, 6].map((i) => ({ clipId: `clip-${i}`, action: "rejected" as const, reason: "no context", at: ago(3) })),
  ];
  const vers = [7, 8, 9].map((i) => clip(`clip-1-v${i}`, { variantOf: "clip-1", edit: { layout: "fill", camSide: "right", captions: "karaoke", jumpCuts: true, zooms: true } }));
  const d = decisions([job([...clips, ...vers], fb)]);
  assert.equal(d.decided, 6);
  assert.deepEqual(d.rejects, [{ reason: "no context", n: 3 }]); // "boring" was overturned
  assert.ok(d.liked.some((b) => b.dim === "hookStyle" && b.label === "question" && b.value === 1));
  assert.ok(d.disliked.some((b) => b.dim === "length" && b.label === "40+"));
  assert.deepEqual(d.versions, [{ change: "layout → fill", n: 3 }]);
  assert.equal(MIN_SAMPLE, 3);
});

const base: Insights = { warnings: [], published: 0, scored: 0, top: [], over: [], under: [], decided: 0, rejects: [], liked: [], disliked: [], versions: [] };

test("formatTaste: empty without data, readable lines, length cap", () => {
  assert.equal(formatTaste(base), "");
  const t = formatTaste({ ...base, rejects: [{ reason: "no context", n: 7 }, { reason: "bad cut", n: 4 }],
    over: [{ dim: "length", label: "20-30", n: 4, value: 1.6 }, { dim: "kind", label: "rage", n: 3, value: 1.4 }], under: [{ dim: "layout", label: "split", n: 3, value: 0.5 }] });
  assert.match(t, /^Owner rejects: no context \(7\), bad cut \(4\) → keep the setup before the punchline; start on the hook/);
  assert.match(t, /Best performers on his channel: 20–30 s clips, rage moments\./);
  assert.match(t, /Under-performing on his channel: split layout\./);
  const long = "x".repeat(400);
  const big = formatTaste({ ...base, rejects: [{ reason: long, n: 9 }], liked: [1, 2, 3, 4].map((i) => ({ dim: "creator" as const, label: long + i, n: 3, value: 1 })),
    over: [{ dim: "creator", label: long, n: 3, value: 2 }], under: [{ dim: "creator", label: long, n: 3, value: 0.1 }] });
  assert.ok(big.length > 0 && big.length <= NOTES_MAX, String(big.length));
});
