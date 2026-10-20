import { test } from "node:test";
import assert from "node:assert/strict";
import { coach, type CoachInput } from "../src/lib/studio-coach-pure.ts";

const t = (views: number, o: Partial<CoachInput["totals"]> = {}) => ({ views, subsGained: 0, subsLost: 0, likes: 0, comments: 0, shares: 0, ...o });
const base = (o: Partial<CoachInput> = {}): CoachInput => ({ totals: t(500, { subsGained: 5 }), prevTotals: t(450), traffic: [{ source: "SHORTS", views: 400 }], ...o });

test("a tiny channel gets one finding: post more", () => {
  const f = coach({ totals: t(3), prevTotals: t(1), traffic: [] });
  assert.equal(f.length, 1);
  assert.match(f[0].title, /^Only 3 views/);
  assert.match(f[0].todo, /1–2 Shorts a day/);
});

test("one dominant video becomes a 'make more like this' finding with its title", () => {
  const f = coach(base({ topVideos: [{ id: "abcdefghijk", views: 300 }] }), () => "Mega hatch");
  assert.ok(f.some((x) => x.level === "good" && /60%/.test(x.title) && /Mega hatch/.test(x.why)));
});

test("engaged share is compared with the channel's own previous period", () => {
  const drop = coach(base({ engaged: { cur: 200, prev: 300 } })); // 40% vs 67%
  assert.ok(drop.some((x) => x.level === "fix" && /down from 67%/.test(x.title)));
  const same = coach(base({ engaged: { cur: 300, prev: 270 } })); // 60% vs 60%
  assert.ok(!same.some((x) => /engaged/.test(x.title)));
  const noPrev = coach(base({ prevTotals: t(20), engaged: { cur: 100, prev: 20 } }));
  assert.ok(!noPrev.some((x) => /engaged/.test(x.title)), "no comparison against a tiny previous period");
});

test("low Shorts-feed share, no subscribers and falling views are flagged; at most 3, fixes first", () => {
  const f = coach({ totals: t(2000, { subsLost: 2 }), prevTotals: t(4000), traffic: [{ source: "SHORTS", views: 200 }] });
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((x) => x.level), ["fix", "fix", "info"]);
  assert.ok(f.some((x) => /2,000 views but you lost more subscribers/.test(x.title)));
  assert.ok(f.some((x) => /Views down 50%/.test(x.title)));
});

test("a healthy, growing range says so", () => {
  const f = coach(base({ totals: t(900, { subsGained: 9 }), prevTotals: t(500) }));
  assert.ok(f.some((x) => x.level === "good" && /Views up 80%/.test(x.title)));
});

test("engaged share going up and zero net subscribers get their own wording", () => {
  assert.ok(coach(base({ engaged: { cur: 400, prev: 270 } })).some((x) => x.level === "good" && /up from 60%/.test(x.title)));
  const f = coach({ totals: t(1500, { subsGained: 2, subsLost: 2 }), prevTotals: t(1400), traffic: [{ source: "SHORTS", views: 1200 }] });
  assert.ok(f.some((x) => /1,500 views but no new subscribers/.test(x.title)));
  assert.ok(!coach(base({ totals: t(900) })).some((x) => /subscribers/.test(x.title)), "under 1000 views: no subscriber finding");
});
