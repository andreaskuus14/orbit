import { test } from "node:test";
import assert from "node:assert/strict";
import { fixScenario, histogram, oneIn, profitOf, scenarioFrom, simulate, takeaways, type Scenario } from "../src/lib/whatif-pure.ts";

const niche = { price: 25, cogs: 8, shipping: 4, feePct: 0.05, cac: 6 };
const flat = (x: number) => ({ lo: x, hi: x });

test("profitOf: orders × kept margin − ads − fixed", () => {
  // 1000 clicks × 2 % = 20 orders × (25 × 0.9 × 0.95 − 12) = 20 × 9.375 = 187.5; ads 300; fixed 30
  assert.equal(profitOf({ traffic: 1000, cr: 0.02, aov: 25, cpc: 0.3, returns: 0.1, cost: 12 }, 0.05, 30), 187.5 - 300 - 30);
});

test("simulate is deterministic for a seed and different for another", () => {
  const s = scenarioFrom(niche);
  const a = simulate(s, 7), b = simulate(s, 7), c = simulate(s, 8);
  assert.deepEqual(a.profits, b.profits);
  assert.equal(a.p50, b.p50);
  assert.notEqual(a.mean, c.mean);
  assert.equal(a.profits.length, 10_000);
  for (let i = 1; i < a.profits.length; i++) assert.ok(a.profits[i - 1] <= a.profits[i]);
  assert.ok(a.p5 <= a.p25 && a.p25 <= a.p50 && a.p50 <= a.p75 && a.p75 <= a.p95);
});

test("flat ranges give one exact answer; break-even CPC makes profit zero", () => {
  const s: Scenario = { traffic: flat(1000), cr: flat(0.02), aov: flat(25), cpc: flat(0.3), returns: flat(0.1), cost: flat(12), feePct: 0.05, fixed: 30, price: 25 };
  const r = simulate(s, 1, 500);
  assert.equal(r.p5, r.p95);
  assert.equal(r.p50, -142.5);
  assert.equal(r.pLoss, 1);
  assert.ok(Math.abs(r.beCpc - (0.02 * 9.375 - 0.03)) < 1e-9);
  assert.ok(Math.abs(profitOf({ traffic: 1000, cr: 0.02, aov: 25, cpc: r.beCpc, returns: 0.1, cost: 12 }, 0.05, 30)) < 1e-9);
  assert.ok(Math.abs(r.beSpend - r.beCpc * 1000) < 1e-9);
});

test("tornado ranks the widest input first and finds its break-even", () => {
  const s: Scenario = { traffic: flat(1000), cr: { lo: 0.005, hi: 0.04 }, aov: flat(25), cpc: flat(0.2), returns: { lo: 0.04, hi: 0.06 }, cost: flat(12), feePct: 0.05, fixed: 0, price: 25 };
  const r = simulate(s, 3);
  assert.equal(r.tornado[0].key, "cr");
  assert.ok(r.tornado[0].atHi > r.tornado[0].atLo);
  const be = r.tornado[0].breakEven!; // others at middle: returns 5 % → kept margin 25 × 0.95 × 0.95 − 12
  assert.ok(Math.abs(be - 0.2 / (25 * 0.95 * 0.95 - 12)) < 1e-6);
  assert.equal(r.tornado.find((t) => t.key === "aov")!.swing, 0);
  assert.ok(r.pLoss > 0.05 && r.pLoss < 0.6);
  const t = takeaways(s, r);
  assert.match(t[1], /^About \d+ in \d+ months lose money unless conversion rate stays above 1\.\d+%/);
  assert.match(t[3], /^Conversion rate matters most/);
});

test("takeaways: no ad price works when orders lose money; almost never when always profitable", () => {
  const bad: Scenario = { traffic: flat(1000), cr: flat(0.02), aov: flat(10), cpc: flat(0.1), returns: flat(0), cost: flat(12), feePct: 0, fixed: 0, price: 10 };
  assert.match(takeaways(bad, simulate(bad, 1, 100))[2], /^No ad price works/);
  const good: Scenario = { ...bad, aov: flat(50) };
  assert.match(takeaways(good, simulate(good, 1, 100))[1], /^Almost no month loses money\.$/);
});

test("fixScenario clamps junk and swaps reversed ranges", () => {
  const s = fixScenario({ ...scenarioFrom(niche), cr: { lo: 0.5, hi: -1 }, traffic: { lo: NaN, hi: 300 }, feePct: 9, fixed: -5 });
  assert.deepEqual(s.cr, { lo: 0, hi: 0.1 });
  assert.deepEqual(s.traffic, { lo: 0, hi: 300 });
  assert.equal(s.feePct, 0.3);
  assert.equal(s.fixed, 0);
});

test("histogram keeps every run and clips outliers into the end bins", () => {
  const h = histogram(Float64Array.from([-100, 0, 1, 2, 9.99, 50]), 0, 10, 10);
  assert.equal(h.reduce((a, b) => a + b, 0), 6);
  assert.deepEqual([h[0], h[1]], [2, 1]);
  assert.equal(h[9], 2);
});

test("oneIn reads like a person", () => {
  assert.equal(oneIn(0.25), "About 1 in 4 months");
  assert.equal(oneIn(0.7), "About 7 in 10 months");
  assert.equal(oneIn(0), "Almost no month");
  assert.equal(oneIn(1), "Practically every month");
});
