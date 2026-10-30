import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPrefs, heldOut, mapLegend, matchesPrefs, MIN_HELD, pairAccuracy, rankingGate, RANKERS, type Feedback } from "../src/lib/news-intel-pure.ts";

test("INT05 map legend: window by fetch time, coverage not significance, placed share", () => {
  const l = mapLegend({ hours: 24, total: 10, untagged: 3 }, Date.parse("2026-10-30T12:00:00Z"));
  assert.deepEqual(l, { from: "2026-10-29 12:00", to: "2026-10-30 12:00", hours: 24, placed: 7, total: 10, untagged: 3, location: "named", size: "coverage", by: "fetched" });
});

const fb = (key: string, vote: Feedback["vote"], sources: number, matched: boolean): Feedback => ({ key, title: key, vote, at: "2026-10-30", sources, matched });

test("INT08 held-out split is deterministic and roughly one in five", () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `https://x.test/${i}`);
  const n = keys.filter(heldOut).length;
  assert.ok(n > 150 && n < 250, String(n));
  assert.equal(heldOut(keys[7]), heldOut(keys[7]));
});

test("INT08 pair accuracy: ties half, one-sided null", () => {
  assert.equal(pairAccuracy([fb("a", "useful", 3, false), fb("b", "wrong", 1, false)], RANKERS.current), 1);
  assert.equal(pairAccuracy([fb("a", "useful", 1, false), fb("b", "not_useful", 1, false)], RANKERS.current), 0.5);
  assert.equal(pairAccuracy([fb("a", "useful", 1, false)], RANKERS.current), null);
});

test("INT08 gate: no change from few votes; adopts only when better on held-out", () => {
  assert.equal(rankingGate([fb("a", "useful", 1, true)]).why, "intel.fb.whyFew");
  const held = Array.from({ length: 400 }, (_, i) => `k${i}`).filter(heldOut).slice(0, MIN_HELD * 2);
  // useful stories match his prefs but have fewer sources: the candidate ranks them better
  const votes = held.map((k, i) => (i % 2 ? fb(k, "useful", 1, true) : fb(k, "not_useful", 2, false)));
  const g = rankingGate(votes);
  assert.equal(g.held, MIN_HELD * 2);
  assert.equal(g.current, 0);
  assert.equal(g.candidate, 1);
  assert.equal(g.adopt, true);
  // training-only votes never move the gate
  const train = Array.from({ length: 400 }, (_, i) => `t${i}`).filter((k) => !heldOut(k)).map((k) => fb(k, "useful", 1, true));
  assert.equal(rankingGate(train).held, 0);
});

test("INT08 preference match on the headline", () => {
  assert.equal(matchesPrefs("Estonia raises defence budget", cleanPrefs({ regions: ["Estonia"] })), true);
  assert.equal(matchesPrefs("Markets fall", cleanPrefs({ regions: ["Estonia"] })), false);
});
