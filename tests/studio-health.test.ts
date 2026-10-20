import { test } from "node:test";
import assert from "node:assert/strict";
import { channelHealth, postedThisWeek } from "../src/lib/studio-health-pure.ts";

const NOW = Date.parse("2026-10-20T18:00:00Z"), H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

test("posted this week counts only Shorts that went live in the last 7 days", () => {
  assert.equal(postedThisWeek([
    { publish: { status: "done", at: iso(NOW - 2 * H) } },
    { publish: { status: "scheduled", scheduledFor: iso(NOW - H) } },
    { publish: { status: "scheduled", scheduledFor: iso(NOW + H) } }, // later today: not yet
    { publish: { status: "done", at: iso(NOW - 8 * 24 * H) } }, // last week
    { publish: { status: "failed" } }, {},
  ], NOW), 2);
});

test("health: lights, and the next step targets the worst one (posting first)", () => {
  const h = channelHealth({ posted: 2, views: 72, shortsViews: 6, engaged: 38, avgViewSec: 20 });
  assert.deepEqual(h.items.map((i) => [i.value, i.light]), [["2 / 7", "red"], ["8%", "red"], ["53%", "green"]]);
  assert.match(h.next, /^Post 1 Short today/);
  const shown = channelHealth({ posted: 7, views: 100, shortsViews: 10, avgViewSec: 40 });
  assert.match(shown.next, /your own/);
  assert.equal(shown.items[2].value, "40 s on average");
  assert.equal(channelHealth({ posted: 7, views: 100, shortsViews: 60, engaged: 60, avgViewSec: 30 }).next, "Looking good: keep the same rhythm and style.");
});

test("health: too few views and unknown posts show grey, never a fake percentage", () => {
  const h = channelHealth({ posted: null, views: 3, shortsViews: 0, engaged: 1, avgViewSec: 5 });
  assert.deepEqual(h.items.map((i) => i.light), ["grey", "grey", "grey"]);
  assert.equal(h.items[1].value, "too few views");
  assert.match(h.next, /^Post 1 Short/);
});
