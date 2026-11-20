import { test } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_DAYS, MAX_KEYS, baselineFor, hotLine, hotness, isHotVsNormal, parseHistory, recordScan, sourceKey, type History } from "../src/lib/reach/baseline-pure.ts";
import { scoreItems, statLine, type ReachItem } from "../src/lib/reach/pure.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const TODAY = new Date(NOW).toLocaleDateString("en-CA");
const day = (n: number) => new Date(NOW - n * 86_400_000).toLocaleDateString("en-CA");
const hist = (key: string, qs: number[]): History => ({ [key]: qs.map((q, i) => ({ day: day(qs.length - i), q })) });
const it = (id: string, metric: number, ageH: number, channel: string): ReachItem =>
  ({ source: "kick", id, title: id, open: `https://kick.com/${channel}/clips/${id}`, channel, created: NOW - ageH * 3_600_000, metric });

test("baseline: median/MAD over prior days only, 14-day window, cold start under 5 days", () => {
  const b = baselineFor(hist("k", [100, 110, 90, 100, 105, 95]).k, TODAY);
  assert.equal(b.days, 6); assert.equal(b.median, 100); assert.equal(b.mad, 5); assert.equal(b.learning, false);
  assert.equal(baselineFor(hist("k", [100, 100, 100, 100]).k, TODAY).learning, true); // 4 days
  assert.equal(baselineFor(undefined, TODAY).learning, true);
  const today = baselineFor([...hist("k", [100, 100, 100, 100, 100]).k, { day: TODAY, q: 9999 }], TODAY); // today's own value never moves its normal
  assert.equal(today.median, 100);
  const old = Array.from({ length: 20 }, (_, i) => ({ day: day(20 - i), q: i < 6 ? 5000 : 100 })); // oldest 6 fall outside 14 days
  assert.equal(baselineFor(old, TODAY).median, 100);
});

test("hotness: a spike scores high, a steady big creator scores normal", () => {
  const steady = baselineFor(hist("k", [4000, 4200, 3900, 4100, 4000, 4050, 3950]).k, TODAY);
  assert.equal(isHotVsNormal(hotness(4300, steady)), false); // big, but its usual
  const small = baselineFor(hist("k", [300, 320, 280, 310, 290, 300]).k, TODAY);
  const h = hotness(1020, small);
  assert.equal(h.ratio, 3.4); assert.ok(h.z >= 3); assert.equal(isHotVsNormal(h), true);
  assert.equal(hotLine(h), "3.4× its usual");
  assert.equal(hotLine(hotness(5, baselineFor(hist("k", [1, 2]).k, TODAY))), "learning (2/5 days)");
  assert.equal(isHotVsNormal(hotness(1e9, baselineFor(hist("k", [1, 2]).k, TODAY))), false);
});

test("scoreItems with history: steady big channel not hot, spiking small channel hot; learning falls back to the batch rule", () => {
  const history: History = { ...hist("kick:bigguy", [3000, 3100, 2900, 3000, 3050, 2950]), ...hist("kick:smallguy", [300, 320, 280, 310, 290, 300]) };
  const xs = scoreItems([it("b1", 3200, 1, "BigGuy"), it("b2", 100, 1, "BigGuy"), it("s1", 1200, 1, "smallguy"), it("s2", 100, 5, "smallguy")], NOW, history);
  assert.equal(xs.find((x) => x.id === "b1")!.hot, false);
  const s1 = xs.find((x) => x.id === "s1")!;
  assert.equal(s1.hot, true); assert.equal(s1.usual!.learning, false);
  assert.match(statLine(s1), /4× its usual/);
  assert.equal(xs[0].id, "s1");
  const cold = scoreItems([it("n1", 5000, 1, "newbie")], NOW, history)[0]; // no history: today's rule (lone item over the floors)
  assert.equal(cold.hot, true); assert.equal(cold.usual!.learning, true); assert.match(statLine(cold), /× the batch · learning \(0\/5 days\)/);
});

test("sourceKey: per channel, Bluesky as one source", () => {
  assert.equal(sourceKey({ source: "reddit", channel: "r/LivestreamFail" }), "reddit:r/livestreamfail");
  assert.equal(sourceKey({ source: "bsky", channel: "@a.bsky.social" }), "bsky");
});

test("recordScan: one snapshot per day (max of scans), 30-day cap, key cap, size stays bounded over 60 simulated days", () => {
  let h: History = {};
  for (let d = 60; d >= 0; d--) {
    const t = new Date(NOW - d * 86_400_000).toLocaleDateString("en-CA");
    for (let s = 0; s < 8; s++) { // 8 scans a day
      const rates = new Map<string, number[]>();
      for (let k = 0; k < 150; k++) rates.set(`kick:c${k}`, [10 + s, 20, 30, 40]);
      h = recordScan(h, rates, t);
    }
  }
  assert.equal(Object.keys(h).length, MAX_KEYS);
  for (const v of Object.values(h)) { assert.ok(v.length <= HISTORY_DAYS); assert.equal(new Set(v.map((x) => x.day)).size, v.length); }
  assert.ok(JSON.stringify(h).length < 120 * 30 * 40); // well under ~150 KB
  const one = recordScan({}, new Map([["a", [10, 100]]]), TODAY);
  assert.equal(recordScan(one, new Map([["a", [1, 2]]]), TODAY).a.length, 1); // same day: still one entry
  assert.equal(recordScan(one, new Map([["a", [1, 2]]]), TODAY).a[0].q, one.a[0].q); // keeps the day's max
});

test("parseHistory drops malformed entries", () => {
  assert.deepEqual(parseHistory(null), {});
  assert.deepEqual(parseHistory({ a: [{ day: "2026-10-01", q: 5.4 }, { day: "x", q: 1 }, { day: "2026-10-02", q: -1 }], b: "no" }), { a: [{ day: "2026-10-01", q: 5 }] });
});
