import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyDue, weeklyReview } from "../src/lib/weekly-pure.ts";

const base = { shorts: [], prevShortsViews: null, business: { contacted: 0, replied: 0, pilots: 0, paying: 0 }, agents: { done: 2, failed: 0 }, memories: 1 };

test("weekly review: totals, trend, best Short and one experiment", () => {
  const w = weeklyReview({ ...base, prevShortsViews: 100, shorts: [1, 2, 3, 4, 5].map((i) => ({ title: `S${i}`, views: i * 30, publishedAt: "x" })) });
  assert.match(w.lines[0], /^5 Shorts published, 450 views \(\+350% vs last week\)\.$/);
  assert.deepEqual(w.best, { title: "S5", views: 150 });
  assert.match(w.experiment, /Hook lab/); // 90 views per Short on average
  assert.match(w.spoken, /^Here's your week\./);
  assert.match(weeklyReview(base).experiment, /one Short a day/);
  assert.equal(weeklyReview(base).best, null);
});

test("weekly review is due on Sunday evening, once", () => {
  const sun = new Date(2026, 9, 25, 19), key = sun.toISOString().slice(0, 10);
  assert.equal(weeklyDue(sun, null), true);
  assert.equal(weeklyDue(sun, key), false);
  assert.equal(weeklyDue(new Date(2026, 9, 25, 10), null), false);
  assert.equal(weeklyDue(new Date(2026, 9, 24, 19), null), false);
});
