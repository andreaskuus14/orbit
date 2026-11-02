import { test } from "node:test";
import assert from "node:assert/strict";
import { baseline, median, outlierLines, parseOutlierInput, scoreOutliers, type OutlierVideo } from "../src/lib/outliers-pure.ts";

const NOW = Date.parse("2026-11-02T12:00:00Z"), DAY = 86_400_000;
const v = (id: string, views: number, daysOld: number, channelId = "UCa"): OutlierVideo =>
  ({ id, title: `T ${id}`, channelId, channel: `Ch ${channelId}`, views, publishedAt: new Date(NOW - daysOld * DAY).toISOString() });

test("median: odd and even counts, empty", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("baseline ignores videos younger than 48 h and flags under 5 as low-confidence", () => {
  const vids = [v("a", 100, 10), v("b", 200, 5), v("c", 300, 3), v("d", 400, 2.5), v("e", 500, 2.1), v("new", 1_000_000, 1)];
  assert.deepEqual(baseline(vids, NOW), { median: 300, n: 5, lowConfidence: false });
  assert.deepEqual(baseline(vids.slice(2), NOW), { median: 400, n: 3, lowConfidence: true });
  assert.deepEqual(baseline([v("x", 9, 0.5)], NOW), { median: null, n: 0, lowConfidence: true });
});

test("scoreOutliers: views / own channel median, 1 decimal, sorted, ties by views then id, limit", () => {
  const a = [v("a1", 100, 10), v("a2", 100, 9), v("a3", 100, 8), v("a4", 100, 7), v("a5", 1234, 6)];
  const b = [v("b1", 1000, 10, "UCb"), v("b2", 1000, 9, "UCb"), v("b3", 12340, 8, "UCb")];
  const up = new Map([["UCa", a], ["UCb", b]]);
  const r = scoreOutliers([...a, ...b, a[4]], up, NOW); // duplicate a5 counted once
  assert.equal(r.length, 8);
  assert.deepEqual(r.slice(0, 2).map((x) => [x.id, x.score]), [["b3", 12.3], ["a5", 12.3]]); // tie: more views first
  assert.equal(r[0].lowConfidence, true); assert.equal(r[1].lowConfidence, false);
  assert.deepEqual(r.slice(2, 4).map((x) => x.id), ["b1", "b2"]); // 1.0 tie, same views: by id
  assert.equal(scoreOutliers([...a, ...b], up, NOW, 3).length, 3);
});

test("empty input and channels without a baseline", () => {
  assert.deepEqual(scoreOutliers([], new Map(), NOW), []);
  assert.deepEqual(scoreOutliers([v("n", 50, 1)], new Map([["UCa", [v("n", 50, 1)]]]), NOW), []);
  assert.match(outlierLines([], NOW), /No outliers found/);
});

test("lines carry title, channel, views, median, score, age, URL and the low-confidence note", () => {
  const up = new Map([["UCa", [v("a1", 1000, 10), v("a2", 3000, 3), v("hit", 25_000, 30)]]]);
  const line = outlierLines(scoreOutliers(up.get("UCa")!, up, NOW, 1), NOW);
  assert.equal(line, `1. "T hit" — Ch UCa · 25,000 views · channel median 3,000 · 8.3x · 30 days old · https://www.youtube.com/watch?v=hit (low confidence: only 3 uploads older than 48 h)`);
});

test("input: channel or query required, limit default 10 and clamped", () => {
  assert.match((parseOutlierInput({}) as { error: string }).error, /^Error: /);
  assert.deepEqual(parseOutlierInput({ channel: " @mrbeast " }), { channel: "@mrbeast", limit: 10 });
  assert.deepEqual(parseOutlierInput({ query: "cs2", limit: "99" }), { query: "cs2", limit: 25 });
  assert.deepEqual(parseOutlierInput({ query: "cs2", limit: 0 }), { query: "cs2", limit: 10 });
});
