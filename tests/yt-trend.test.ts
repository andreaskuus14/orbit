import { test } from "node:test";
import assert from "node:assert/strict";
import { findYtRisers, hotTopics, parsePopular, parseYtSnaps, type YtSnap } from "../src/lib/yt-trend-pure.ts";
import { dueAlerts, pushSnap } from "../src/lib/trend-rise-pure.ts";

const H = 3600_000, T = 1_700_000_000_000;
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`; // 11 chars
// [id number, views] in rank order
const snap = (at: number, list: [number, number][]): YtSnap => ({ at, videos: list.map(([i, views], k) => ({ id: vid(i), title: `T${i}`, channel: "C", views, rank: k + 1 })) });
const filler = (from: number, count: number): [number, number][] => Array.from({ length: count }, (_, k) => [from + k, 1_000_000]);

test("parsePopular ranks items and drops junk ids", () => {
  const s = parsePopular({ items: [{ id: "bad" }, { id: vid(1), snippet: { title: "Hi", channelTitle: "Ch" }, statistics: { viewCount: "1234" } }, { id: vid(2) }] }, T);
  assert.deepEqual(s.videos.map((v) => [v.id, v.rank, v.views, v.title, v.channel]), [[vid(1), 1, 1234, "Hi", "Ch"], [vid(2), 2, 0, "", ""]]);
  assert.deepEqual(parsePopular(null, T).videos, []);
});

test("velocity, rank climb and new entries; slow movers ignored", () => {
  const before = snap(T - 2 * H, [[1, 100_000], [2, 500_000], ...filler(100, 10), [3, 50_000]]);
  const now = snap(T, [[3, 60_000], [1, 400_000], [2, 510_000], [9, 80_000]]);
  const r = findYtRisers([before, now]);
  assert.deepEqual(r.map((x) => x.id), [vid(1), vid(3), vid(9)]); // 2 gained only 5k/h, no climb
  assert.deepEqual([r[0].viewsPerHour, r[0].strong], [150_000, true]);
  assert.deepEqual([r[1].rankJump, r[1].strong, r[1].viewsPerHour], [12, false, 5000]);
  assert.deepEqual([r[2].isNew, r[2].viewsPerHour, r[2].rank], [true, null, 4]);
});

test("no base snapshot in range → nothing", () => {
  assert.deepEqual(findYtRisers([snap(T - 10 * 60_000, [[1, 1]]), snap(T, [[2, 9]])]), []);
  assert.deepEqual(findYtRisers([snap(T - 40 * H, [[1, 1]]), snap(T, [[2, 9]])]), []);
  assert.deepEqual(findYtRisers([]), []);
});

test("parseYtSnaps drops junk; pushSnap works for YouTube snaps", () => {
  assert.deepEqual(parseYtSnaps([null, { at: 3, videos: [{ id: "x" }] }, { at: 1, videos: [] }]).map((s) => [s.at, s.videos.length]), [[1, 0], [3, 0]]);
  assert.equal(pushSnap([snap(T - 8 * 24 * H, [])], snap(T, [])).length, 1);
});

test("hotTopics finds shared game names, skips filler words", () => {
  const t = hotTopics(["Grow a Garden NEW update!!", "I tried Grow a Garden for 100 days", "Minecraft but…", "MINECRAFT hardcore", "Fortnite live"]);
  assert.deepEqual(t, [{ term: "grow garden", count: 2 }, { term: "minecraft", count: 2 }]);
  assert.deepEqual(hotTopics([]), []);
});

test("dueAlerts with a YouTube key shares the day map", () => {
  const r = findYtRisers([snap(T - H, [[1, 0]]), snap(T, [[1, 200_000]])]);
  const a = dueAlerts(r, { "5": "2026-10-18", "6": "2026-10-17" }, "2026-10-18", (x) => `yt:${x.id}`);
  assert.equal(a.due.length, 1);
  assert.deepEqual(a.next, { "5": "2026-10-18", [`yt:${vid(1)}`]: "2026-10-18" });
});
