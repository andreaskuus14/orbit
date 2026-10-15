import { test } from "node:test";
import assert from "node:assert/strict";
import { moonRadius, takeoff, parseChannelInput, parseIsoDuration, type Video } from "../src/lib/youtube-pure.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const v = (id: string, daysAgo: number, views: number): Video => ({
  id, title: id, publishedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(), views, likes: 0, comments: 0, durationSec: 300, thumb: "",
});

test("moonRadius is finite and clamped at the edges", () => {
  assert.equal(moonRadius(0, 0), 0.12);
  assert.equal(moonRadius(0, 1000), 0.12);
  assert.equal(moonRadius(500, 0), 0.12);
  assert.equal(moonRadius(NaN, NaN), 0.12);
  assert.equal(moonRadius(1000, 1000), 0.6);
  assert.equal(moonRadius(5000, 1000), 0.6, "above max stays clamped");
  const mid = moonRadius(100, 10_000);
  assert.ok(mid > 0.12 && mid < 0.6 && Number.isFinite(mid));
});

test("takeoff flags a new video running well above the channel's pace", () => {
  // Others: 100 views over 10/20/30 days → 10, 5, 3.3 views/day (median 5). New: 300 views in 2 days = 150/day.
  const hits = takeoff([v("new", 2, 300), v("a", 10, 100), v("b", 20, 100), v("c", 30, 100)], NOW);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "new");
  assert.equal(hits[0].ratio, 30);
});

test("takeoff needs at least 3 other videos", () => {
  assert.deepEqual(takeoff([v("new", 2, 300), v("a", 10, 100), v("b", 20, 100)], NOW), []);
  assert.deepEqual(takeoff([], NOW), []);
});

test("takeoff ignores videos older than 14 days and normal performers", () => {
  assert.deepEqual(takeoff([v("old", 20, 100_000), v("a", 30, 100), v("b", 40, 100), v("c", 50, 100)], NOW), []);
  assert.deepEqual(takeoff([v("new", 2, 10), v("a", 10, 100), v("b", 20, 100), v("c", 30, 100)], NOW), []);
  // A silent channel: the floor stops a handful of views reading as a comet.
  assert.deepEqual(takeoff([v("new", 1, 2), v("a", 10, 0), v("b", 20, 0), v("c", 30, 0)], NOW), []);
});

test("parseChannelInput accepts handles, ids and channel URLs", () => {
  const id = "UC" + "a".repeat(22);
  assert.deepEqual(parseChannelInput("@MyChannel"), { handle: "@MyChannel" });
  assert.deepEqual(parseChannelInput(` ${id} `), { id });
  assert.deepEqual(parseChannelInput("https://www.youtube.com/@my.channel/videos"), { handle: "@my.channel" });
  assert.deepEqual(parseChannelInput(`youtube.com/channel/${id}`), { id });
  assert.equal(parseChannelInput("https://evil.com/@x/youtube.com/@abc"), null);
  assert.equal(parseChannelInput("mychannel"), null);
  assert.equal(parseChannelInput(""), null);
  assert.equal(parseChannelInput(undefined), null);
});

test("parseIsoDuration reads YouTube durations", () => {
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.equal(parseIsoDuration("PT45S"), 45);
  assert.equal(parseIsoDuration("P1DT5M"), 86_700);
  assert.equal(parseIsoDuration("garbage"), 0);
});
