import { test } from "node:test";
import assert from "node:assert/strict";
import { bestStreak, todayCount, weekCompletion } from "../src/lib/life-stats-pure.ts";

const wk = (pattern: string) => [...pattern].map((c, i) => ({ date: `2026-10-${String(10 + i).padStart(2, "0")}`, scheduled: c !== "-", done: c === "x" }));

test("weekCompletion: per-day % of scheduled habits done, null when nothing scheduled", () => {
  const days = weekCompletion([{ week: wk("xx-oxxo") }, { week: wk("xo-xxxx") }]);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-10-10");
  assert.deepEqual(days.map((d) => d.pct), [100, 50, null, 50, 100, 100, 50]);
  assert.deepEqual(weekCompletion([]), []);
});

test("todayCount counts only habits scheduled today", () => {
  assert.deepEqual(todayCount([
    { scheduledToday: true, doneToday: true }, { scheduledToday: true, doneToday: false }, { scheduledToday: false, doneToday: false },
  ]), { done: 1, total: 2 });
});

test("bestStreak picks the longest running streak, null when none", () => {
  assert.equal(bestStreak([{ name: "a", streak: 2 }, { name: "b", streak: 5 }, { name: "c", streak: 5 }])?.name, "b");
  assert.equal(bestStreak([{ name: "a", streak: 0 }]), null);
});
