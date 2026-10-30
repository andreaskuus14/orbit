import { test } from "node:test";
import assert from "node:assert/strict";
import { COST_BPS, compareStrategy, journalEntry, journalTally, reviewDue, reviewEntry, scenarios } from "../src/lib/markets-study-pure.ts";
import type { Bar } from "../src/lib/markets-pure.ts";

const days = (n: number, f: (i: number) => number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10), close: f(i) }));

test("MKT07 baseline buy-and-hold on a steady rise, costs charged once, no lookahead", () => {
  const hist = { AAA: days(160, (i) => 100 * 1.001 ** i), BBB: days(160, (i) => 50 * 1.001 ** i) };
  const s = compareStrategy("ma", ["AAA", "BBB"], hist);
  assert.ok(!("error" in s));
  // baseline: fully invested from the start of the compared window, one entry turnover of 1
  assert.equal(s.baseline.full.exposure, 1);
  assert.equal(s.baseline.full.turnover, 1);
  assert.ok(s.baseline.full.maxDrawdown < 0.001); // only the entry cost
  // rule and baseline cover the same dates
  assert.equal(s.rule.full.from, s.baseline.full.from);
  assert.equal(s.rule.full.to, s.baseline.full.to);
  assert.ok(s.notes.includes("mk.st.noteSelection"));
  assert.equal(s.costBps, COST_BPS);
});

test("MKT07 the rule cannot see the close it trades at", () => {
  // A spike on one day only: a lookahead rule would hold before it; ours can't react until after.
  const base = days(160, () => 100);
  const spiky = base.map((b, i) => ({ ...b, close: i === 120 ? 200 : 100 }));
  const s = compareStrategy("rebalance", ["AAA"], { AAA: spiky });
  assert.ok(!("error" in s));
  // rebalance holds through; the spike up and back down nets ~0 for both (minus costs), never a free gain
  assert.ok(s.rule.full.ret <= 0.0001);
  assert.ok(s.rule.full.maxDrawdown >= 0.49); // the drop after the spike is a real drawdown
});

test("MKT07 refuses short or missing history", () => {
  assert.ok("error" in compareStrategy("ma", ["AAA"], { AAA: days(30, () => 1) }));
  assert.ok("error" in compareStrategy("ma", [], {}));
  assert.ok("error" in compareStrategy("off", ["AAA"], { AAA: days(200, () => 1) }));
});

test("MKT08 journal: needs thesis, invalidation, future review date; review is his outcome", () => {
  const now = new Date("2026-10-30T10:00:00Z");
  assert.equal(typeof journalEntry({ ticker: "spy", action: "buy", thesis: "short", invalidation: "x", reviewOn: "2026-12-01" }, "1", now, 1), "string");
  assert.equal(journalEntry({ ticker: "spy", action: "buy", thesis: "Broad index for ten years", invalidation: "need cash", reviewOn: "2026-10-30" }, "1", now, 1), "Review date must be a future date");
  const e = journalEntry({ ticker: "spy", action: "buy", thesis: "Broad index for ten years", invalidation: "need the cash", reviewOn: "2026-12-01" }, "1", now, 500);
  assert.ok(typeof e !== "string");
  assert.equal(e.ticker, "SPY");
  assert.equal(reviewDue(e, "2026-11-30"), false);
  assert.equal(reviewDue(e, "2026-12-01"), true);
  const r = reviewEntry(e, { outcome: "mixed", note: "ok" }, now, 510);
  assert.ok(typeof r !== "string");
  assert.equal(reviewDue(r, "2027-01-01"), false);
  assert.deepEqual(journalTally([e, r]), { reviewed: 1, open: 1, by: { right: 0, wrong: 0, mixed: 1, unclear: 0 } });
});

test("MKT08 scenarios: per currency, unpriced listed not assumed", () => {
  const s = scenarios([
    { ticker: "A", currency: "USD", shares: 10, price: 100 },
    { ticker: "B", currency: "USD", shares: 1, price: 1000 },
    { ticker: "C", currency: "EUR", shares: 2, price: 50 },
    { ticker: "D", currency: "USD", shares: 5, price: null },
  ], [-10]);
  assert.deepEqual(s.shocks, [{ pct: -10, change: { USD: -200, EUR: -10 } }]);
  assert.deepEqual(s.unpriced, ["D"]);
  assert.equal(s.biggest.USD.change, -100);
  assert.equal(s.biggest.USD.share, 0.5);
});
