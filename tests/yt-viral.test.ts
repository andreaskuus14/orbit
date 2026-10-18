import { test } from "node:test";
import assert from "node:assert/strict";
import { nicheQueries, parseViral, searchIds, shortsUrl } from "../src/lib/yt-viral-pure.ts";

const NOW = Date.parse("2026-10-18T12:00:00Z"), H = 3600_000;
const item = (id: string, views: number, hAgo: number) => ({ id, snippet: { title: `<b>${id}</b>\n`, channelTitle: "Clips", publishedAt: new Date(NOW - hAgo * H).toISOString() }, statistics: { viewCount: String(views) } });

test("nicheQueries: winners first, dedupe, cap 3, no unknown", () => {
  assert.deepEqual(nicheQueries(["Kai Cenat", "unknown"], ["kai cenat", "IShowSpeed"], ["fortnite", "x"]), ["Kai Cenat", "IShowSpeed", "fortnite"]);
  assert.deepEqual(nicheQueries([], [], []), []);
});

test("searchIds: unique valid ids only", () => {
  assert.deepEqual(searchIds({ items: [{ id: { videoId: "abcdefghijk" } }, { id: { videoId: "bad" } }] }, { items: [{ id: { videoId: "abcdefghijk" } }] }, null), ["abcdefghijk"]);
});

test("parseViral: views/hour, 48 h window, hot outliers, plain text, bad ids dropped", () => {
  const v = parseViral({ items: [item("aaaaaaaaaaa", 1_000_000, 10), item("bbbbbbbbbbb", 20_000, 10), item("ccccccccccc", 10_000, 10), item("ddddddddddd", 30_000, 10),
    item("old00000000", 9_000_000, 60), item("bad", 1, 1), item("fresh000000", 2_500, 0.1)] }, NOW);
  assert.deepEqual(v.map((x) => x.id), ["aaaaaaaaaaa", "ddddddddddd", "fresh000000", "bbbbbbbbbbb", "ccccccccccc"]);
  assert.equal(v[0].viewsPerHour, 100_000); assert.ok(v[0].hot);
  assert.ok(!v.slice(1).some((x) => x.hot));
  assert.equal(v[2].ageHours, 1); // < 1 h counts as 1 h
  assert.equal(v[0].title, "<b>aaaaaaaaaaa</b>"); // control chars stripped; React renders it as text
  assert.equal(shortsUrl("aaaaaaaaaaa"), "https://www.youtube.com/shorts/aaaaaaaaaaa");
  assert.equal(shortsUrl("x/../evil.."), null);
});
