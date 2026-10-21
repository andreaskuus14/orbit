import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStats, emptyLearn, formatTaste, insights, learnDue, learnProblem, needs48h, results48, LEARN_EVERY_MS, NOTES_MAX, RESULTS_AGE_MS, RESULTS_POLL_MS, type LearnRec } from "../src/lib/clips/learn-pure.ts";

const NOW = Date.parse("2026-10-21T12:00:00Z"), H = 3_600_000;
const rec = (i: number, views: number, age = 48): LearnRec => ({ videoId: `vid${String(i).padStart(8, "0")}`, jobId: "job", clipId: `clip${i}`,
  title: `Title ${i}`, hook: `Hook ${i}`, reason: "", layout: "fit", captions: "karaoke", durationSec: 20, sourceChannel: "owner", kind: "other",
  publishedAt: new Date(NOW - age * H).toISOString(), snaps: { "48h": { at: new Date(NOW).toISOString(), views, likes: 0, comments: 0, avgViewPct: 85 } } });
const state = (recs: LearnRec[]) => ({ ...emptyLearn(), clips: Object.fromEntries(recs.map((r) => [r.videoId, r])) });

test("48h capture: inclusive start, six-hour window, immutable snapshot, never backfill lifetime totals", () => {
  const r = { ...rec(1, 0), snaps: {} }, stats = { at: new Date(NOW).toISOString(), views: 100, likes: 2, comments: 1, avgViewPct: 120 };
  assert.equal(applyStats(r, stats, r.publishedAt, NOW - 1).snaps["48h"], undefined);
  const captured = applyStats(r, stats, r.publishedAt, NOW);
  assert.equal(captured.snaps["48h"]!.views, 100);
  assert.equal(captured.snaps["48h"]!.avgViewPct, 120); // rewatches may exceed 100%
  assert.equal(applyStats(captured, { ...stats, views: 999 }, undefined, NOW + H).snaps["48h"]!.views, 100);
  assert.ok(applyStats(r, stats, r.publishedAt, NOW + LEARN_EVERY_MS - 1).snaps["48h"]);
  assert.equal(applyStats(r, stats, r.publishedAt, NOW + LEARN_EVERY_MS).snaps["48h"], undefined);
  assert.equal(applyStats(r, stats, r.publishedAt, NOW + 100 * H).snaps["48h"], undefined);
  assert.deepEqual(r.snaps, {});
  assert.equal(needs48h({ ...r, publishedAt: undefined }, NOW), false);
  assert.equal(needs48h({ ...r, publishedAt: new Date(NOW + H).toISOString() }, NOW), false);
  assert.equal(RESULTS_AGE_MS, 48 * H);
});

test("48h poll bypasses six-hour refresh only near a missing milestone, with 15-min retry backoff", () => {
  const r = { ...rec(1, 0), snaps: {} }, s = { ...state([r]), checkedAt: new Date(NOW - RESULTS_POLL_MS).toISOString() };
  assert.equal(learnDue(s, NOW), true);
  assert.equal(learnDue(s, NOW - 1), false);
  assert.equal(learnDue(state([r]), NOW), true);
  assert.equal(learnDue({ ...s, clips: state([rec(1, 0)]).clips }, NOW), false);
  assert.equal(learnDue({ ...s, clips: state([{ ...r, publishedAt: new Date(NOW - 54 * H).toISOString() }]).clips }, NOW), false);
  assert.equal(learnDue({ ...s, checkedAt: new Date(NOW - 6 * H).toISOString() }, NOW), true);
});

test("48h results use like-aged channel median and recency, preserving retention independently", () => {
  const rows = [rec(1, 100, 60), rec(2, 200, 70), rec(3, 400, 50), { ...rec(4, 0), snaps: { "72h": { at: "", views: 99999, likes: 0, comments: 0 } } }];
  const before = structuredClone(rows), results = results48(rows);
  assert.deepEqual(results.map((r) => r.videoId), [rows[2].videoId, rows[0].videoId, rows[1].videoId]);
  assert.deepEqual(results.map((r) => [r.medianViews, r.changePct, r.verdict]), [[200, 100, "worked"], [200, -50, "flopped"], [200, 0, "worked"]]);
  assert.equal(results[0].avgViewPct, 85);
  assert.deepEqual(rows, before);
  assert.equal(results48([rec(1, 1), rec(2, 3)])[0].verdict, null);
  assert.ok(results48([rec(1, 0), rec(2, 0), rec(3, 0)]).every((r) => r.changePct === null && r.verdict === null));
  assert.equal(results48([rec(1, 1), rec(2, 3), rec(3, 5), rec(4, 7)])[0].medianViews, 4);
});

test("taste gets latest five worked and five flopped title/hook pairs, even with other long taste hints", () => {
  const rows = Array.from({ length: 14 }, (_, i) => rec(i + 1, i % 2 ? 1000 : 10, 60 + i));
  const i = insights(state(rows), []);
  assert.equal(i.worked!.length, 5); assert.equal(i.flopped!.length, 5); assert.equal(i.lastShorts!.length, 10);
  assert.deepEqual(i.worked!.map((r) => r.title), [2, 4, 6, 8, 10].map((n) => `Title ${n}`));
  assert.deepEqual(i.flopped!.map((r) => r.title), [1, 3, 5, 7, 9].map((n) => `Title ${n}`));
  const t = formatTaste({ ...i, rejected: [{ title: "x".repeat(1000) }] });
  assert.match(t, /Worked at 48h/); assert.match(t, /Flopped at 48h/);
  for (let n = 1; n <= 10; n++) { assert.ok(t.includes(`Title ${n}\"`)); assert.ok(t.includes(`Hook ${n}\"`)); }
  assert.doesNotMatch(t, /Title 12/); assert.ok(t.length <= NOTES_MAX);
  const long = formatTaste({ ...i, worked: i.worked!.map((r) => ({ ...r, title: '"<>\n'.repeat(100), hook: "long ".repeat(100) })) });
  assert.ok(long.length <= NOTES_MAX); assert.match(long, /Flopped at 48h/); assert.doesNotMatch(long, /[<>]/);
});

test("48h snapshots retain the v1 store format; invalid optional metrics are rejected", () => {
  assert.equal(learnProblem(state([rec(1, 100)])), "");
  const r = rec(1, 100); r.snaps["48h"]!.avgViewPct = NaN;
  assert.match(learnProblem(state([r])), /bad stats/);
});

test("optional Analytics metrics: omit missing, invalid and negative values; retain real zeros and rewatches", async () => {
  const { analyticsStats } = await import("../src/lib/clips/learn-pure.ts");
  assert.deepEqual(analyticsStats({}), {});
  assert.deepEqual(analyticsStats({ averageViewPercentage: "", averageViewDuration: "no data", subscribersGained: -1 }), {});
  assert.deepEqual(analyticsStats({ averageViewPercentage: 120.25, averageViewDuration: "18.25", subscribersGained: 0 }), { avgViewPct: 120.3, avgViewSec: 18.3, subs: 0 });
});
