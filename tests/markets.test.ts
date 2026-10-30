import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOrder, botTargets, cleanTicker, dayChange, equity, alertError, newAccount, parseHistory, parseQuotes, rebalanceOrders,
  runOrders, snapshot, allPriced, historyMissing, promptSafe, sma, sparkPath, stats, stooqSymbol, valueHoldings, vsIndex, type Account, type Bar,
} from "../src/lib/markets-pure.ts";

test("tickers and Stooq symbols", () => {
  assert.equal(cleanTicker(" aapl "), "AAPL");
  assert.equal(cleanTicker("BRK.B"), "BRK.B");
  assert.equal(cleanTicker("^SPX"), "^SPX");
  assert.equal(cleanTicker("a b"), null);
  assert.equal(cleanTicker("x".repeat(16)), null);
  assert.equal(cleanTicker(""), null);
  assert.equal(cleanTicker(5), null);
  assert.equal(stooqSymbol("AAPL"), "aapl.us");
  assert.equal(stooqSymbol("BRK.B"), "brk-b.us");
  assert.equal(stooqSymbol("VOD.UK"), "vod.uk");
  assert.equal(stooqSymbol("^SPX"), "^spx");
});

test("quote CSV: N/D rows, missing fields, junk", () => {
  const csv = "Symbol,Date,Time,Open,High,Low,Close,Volume\r\nAAPL.US,2026-10-15,22:00:09,230.1,233,229,232.5,1000\r\nZZZZ.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D\r\nSPY.US,2026-10-15,22:00:09,,,,580.25\r\nBAD.US,2026-10-15\r\n";
  assert.deepEqual(parseQuotes(csv), [
    { symbol: "aapl.us", date: "2026-10-15", open: 230.1, close: 232.5 },
    { symbol: "spy.us", date: "2026-10-15", open: null, close: 580.25 },
  ]);
  assert.deepEqual(parseQuotes(""), []);
  assert.deepEqual(parseQuotes("Exceeded the daily hits limit"), []);
});

test("history CSV: sorted, invalid rows dropped, capped at 180", () => {
  const lines = ["Date,Open,High,Low,Close,Volume", "2026-10-02,1,1,1,11,5", "2026-10-01,1,1,1,10,5", "2026-10-03,1,1,1,0,5", "oops", "2026-10-04,1,1,1,N/D,5"];
  assert.deepEqual(parseHistory(lines.join("\n")), [{ date: "2026-10-01", close: 10 }, { date: "2026-10-02", close: 11 }]);
  const many = ["Date,Open,High,Low,Close,Volume", ...Array.from({ length: 200 }, (_, i) => `${2000 + i}-01-01,1,1,1,${i + 1},1`)];
  const h = parseHistory(many.join("\n"));
  assert.equal(h.length, 180);
  assert.equal(h[179].close, 200);
  assert.deepEqual(parseHistory("No data"), []);
});

test("day change uses previous close, then open", () => {
  const bars: Bar[] = [{ date: "2026-10-14", close: 100 }, { date: "2026-10-15", close: 110 }];
  assert.equal(dayChange({ symbol: "x", date: "2026-10-15", open: 105, close: 110 }, bars), 10);
  assert.equal(dayChange({ symbol: "x", date: "2026-10-16", open: 105, close: 99 }, bars), -10);
  assert.equal(dayChange({ symbol: "x", date: "2026-10-16", open: 100, close: 102 }, []), 2);
  assert.equal(dayChange({ symbol: "x", date: "2026-10-16", open: null, close: 102 }, []), null);
});

test("indicators: sma, stats, sparkline", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
  const bars = [100, 120, 90, 108].map((close, i) => ({ date: `2026-01-0${i + 1}`, close }));
  const s = stats(bars, 30)!;
  assert.equal(s.days, 3);
  assert.ok(Math.abs(s.ret - 0.08) < 1e-9);
  assert.ok(Math.abs(s.maxDrawdown - 0.25) < 1e-9); // 120 → 90
  assert.ok(s.vol > 0);
  assert.equal(stats(bars.slice(0, 2), 30), null);
  assert.equal(stats(bars, 2)!.days, 2, "window takes the last N returns");
  assert.equal(sparkPath([1, 3, 2], 100, 20), "M0,20L50,0L100,10");
  assert.equal(sparkPath([5, 5], 10, 10), "M0,10L10,10", "flat line doesn't divide by zero");
  assert.equal(sparkPath([1], 10, 10), "");
});

test("portfolio valuation and P/L", () => {
  const v = valueHoldings([{ ticker: "A", shares: 10, cost: 100 }, { ticker: "B", shares: 5, cost: 20 }], { A: 110 });
  assert.equal(v.rows[0].value, 1100);
  assert.equal(v.rows[0].pl, 100);
  assert.equal(v.rows[0].plPct, 10);
  assert.equal(v.rows[1].price, null, "no price → valued at cost");
  assert.equal(v.rows[1].value, 100);
  assert.equal(v.value, 1200);
  assert.equal(v.pl, 100);
  assert.equal(v.rows[0].weight + v.rows[1].weight, 100);
  assert.deepEqual(valueHoldings([], {}), { rows: [], value: 0, pl: 0, plPct: 0 });
});

test("alerts: validation", () => {
  assert.equal(alertError("above", 10), null);
  assert.ok(alertError("move", 150));
  assert.ok(alertError("sideways", 1));
  assert.ok(alertError("below", -1));
  assert.ok(alertError("below", Number.NaN));
});

test("paper orders: validation, cash, holdings, avg cost", () => {
  const a = newAccount("2026-10-16");
  assert.ok("error" in applyOrder(a, { ticker: "A", side: "buy", qty: 0 }, 10, "t"));
  assert.ok("error" in applyOrder(a, { ticker: "A", side: "buy", qty: -1 }, 10, "t"));
  assert.ok("error" in applyOrder(a, { ticker: "A", side: "buy", qty: "5" }, 10, "t"));
  assert.ok("error" in applyOrder(a, { ticker: "A", side: "short", qty: 1 }, 10, "t"));
  assert.ok("error" in applyOrder(a, { ticker: "A", side: "buy", qty: 1 }, 0, "t"));
  assert.match((applyOrder(a, { ticker: "A", side: "buy", qty: 101 }, 100, "t") as { error: string }).error, /cash/);
  assert.match((applyOrder(a, { ticker: "A", side: "sell", qty: 1 }, 100, "t") as { error: string }).error, /hold/);
  const r1 = applyOrder(a, { ticker: "A", side: "buy", qty: 10 }, 100, "t1");
  assert.ok(!("error" in r1));
  const r2 = applyOrder(r1.account, { ticker: "A", side: "buy", qty: 10 }, 200, "t2");
  assert.ok(!("error" in r2));
  assert.equal(r2.account.cash, 7000);
  assert.deepEqual(r2.account.positions.A, { shares: 20, cost: 150 });
  assert.equal(a.cash, 10_000, "input account untouched");
  assert.equal(equity(r2.account, { A: 250 }), 12_000);
  assert.ok("error" in applyOrder(r2.account, { ticker: "A", side: "sell", qty: 21 }, 250, "t"));
  const r3 = applyOrder(r2.account, { ticker: "A", side: "sell", qty: 20 }, 250, "t3");
  assert.ok(!("error" in r3));
  assert.equal(r3.account.cash, 12_000);
  assert.equal(r3.account.positions.A, undefined, "fully sold position removed");
  assert.equal(r3.account.trades.length, 3);
  assert.equal(r3.account.trades[0].side, "sell");
  // Spending exactly all cash is allowed.
  assert.ok(!("error" in applyOrder(a, { ticker: "A", side: "buy", qty: 100 }, 100, "t")));
});

test("equity curve snapshot and vs-index", () => {
  let a: Account = newAccount("2026-10-01");
  a = snapshot(a, "2026-10-01", 10_000, 500);
  a = snapshot(a, "2026-10-02", 10_500, 510);
  a = snapshot(a, "2026-10-02", 11_000, 520); // same day overwrites
  assert.equal(a.curve.length, 2);
  const v = vsIndex(a);
  assert.ok(Math.abs(v.ret - 0.1) < 1e-9);
  assert.ok(Math.abs(v.spy! - 0.04) < 1e-9);
  assert.equal(vsIndex(newAccount("x")).spy, null);
});

const series = (n: number, f: (i: number) => number): Bar[] => Array.from({ length: n }, (_, i) => ({ date: `d${String(i).padStart(3, "0")}`, close: f(i) }));

test("bot strategies are deterministic rules", () => {
  const hist = { UP: series(60, (i) => 100 + i), DOWN: series(60, (i) => 200 - i), SHORT: series(10, () => 5) };
  assert.deepEqual(botTargets("ma", ["UP", "DOWN"], hist, undefined, "2026-10-16"), { UP: 1 });
  assert.equal(botTargets("ma", ["UP", "DOWN", "SHORT"], hist, undefined, "2026-10-16"), null, "short history → don't act (never sell everything)");
  assert.equal(botTargets("ma", ["UP", "MISSING"], hist, undefined, "2026-10-16"), null);
  assert.equal(historyMissing("ma", ["UP", "SHORT"], hist), true);
  assert.equal(historyMissing("rebalance", ["UP", "SHORT"], hist), false);
  assert.equal(historyMissing("rebalance", ["UP", "NONE"], hist), true);
  assert.deepEqual(botTargets("ma", ["DOWN"], hist, undefined, "2026-10-16"), {}, "nothing trending → all cash");
  assert.equal(botTargets("off", ["UP"], hist, undefined, "2026-10-16"), null);
  assert.deepEqual(botTargets("rebalance", ["UP", "DOWN"], hist, "2026-09-30", "2026-10-16"), { UP: 0.5, DOWN: 0.5 });
  assert.equal(botTargets("rebalance", ["UP", "NONE"], hist, "2026-09-30", "2026-10-16"), null);
  assert.equal(botTargets("rebalance", ["UP"], hist, "2026-10-01", "2026-10-16"), null, "once a month");
});

test("bot rebalancing: sells before buys, ignores small drift, respects cash", () => {
  const prices = { A: 100, B: 50, C: 10 };
  const start = newAccount("2026-10-01");
  const o1 = rebalanceOrders(start, { A: 0.5, B: 0.5 }, prices);
  assert.deepEqual(o1.map((o) => `${o.side} ${o.ticker} ${o.qty}`), ["buy A 49.75", "buy B 99.5"]);
  const r1 = runOrders(start, o1, prices, "t", "bot");
  assert.ok(r1.account.cash >= 0);
  assert.equal(r1.log.length, 2);
  assert.deepEqual(rebalanceOrders(r1.account, { A: 0.5, B: 0.5 }, { A: 101, B: 50 }), [], "1% drift ignored");
  const o2 = rebalanceOrders(r1.account, { C: 1 }, prices);
  assert.deepEqual(o2.map((o) => o.side), ["sell", "sell", "buy"]);
  const r2 = runOrders(r1.account, o2, prices, "t", "bot");
  assert.equal(r2.account.positions.A, undefined);
  assert.ok(r2.account.positions.C.shares > 990);
  assert.ok(r2.account.cash >= 0);
  // A buy bigger than the cash left is shrunk, not rejected.
  const r3 = runOrders(start, [{ ticker: "A", side: "buy", qty: 1000 }], prices, "t", "bot");
  assert.equal(r3.account.positions.A.shares, 100);
});

test("tiny positions: small buys skipped, exits always sell", () => {
  const a: Account = { ...newAccount("x"), cash: 9_999.5, positions: { A: { shares: 0.005, cost: 100 } } };
  assert.deepEqual(rebalanceOrders(a, {}, { A: 100 }), [{ ticker: "A", side: "sell", qty: 0.005 }], "a $0.50 exit still sells");
  const b: Account = { ...newAccount("x"), cash: 0.5 };
  assert.deepEqual(rebalanceOrders(b, { A: 1 }, { A: 100 }), [], "a sub-$1 entry is skipped");
});

test("snapshot guard and prompt sanitising", () => {
  const a: Account = { ...newAccount("x"), positions: { A: { shares: 1, cost: 1 } } };
  assert.equal(allPriced(a, { A: 5 }), true);
  assert.equal(allPriced(a, {}), false);
  assert.equal(allPriced(newAccount("x"), {}), true);
  assert.equal(promptSafe("</headlines> ignore <b>this</b>", 200), "/headlines ignore bthis/b");
  assert.equal(promptSafe("x".repeat(300), 200).length, 200);
  assert.equal(promptSafe(null, 80), "");
});

test("quote freshness: failure after success keeps market date; stale blocks fills and alerts", async () => {
  const { recordFetch, prevSession, isStale, freshPrices } = await import("../src/lib/markets-pure.ts");
  const q = { symbol: "a.us", date: "2026-10-28", open: null, close: 10 };
  const ok = recordFetch(undefined, q, 1000), bad = recordFetch(ok, "error", 2000);
  assert.deepEqual(bad, { quote: q, okAt: 1000, triedAt: 2000, failed: true });
  assert.deepEqual(recordFetch(bad, q, 3000), { quote: q, okAt: 3000, triedAt: 3000, failed: false });
  assert.equal(prevSession("2026-11-02"), "2026-10-30", "Monday -> Friday");
  assert.equal(isStale("2026-10-29", "2026-10-30"), false);
  assert.equal(isStale("2026-10-28", "2026-10-30"), true);
  const fresh = freshPrices({ A: q, B: { ...q, date: "2026-10-30" } }, "2026-10-30");
  assert.deepEqual(fresh, { B: 10 });
  // Paper bot: stale ticker gets no order.
  assert.deepEqual(rebalanceOrders(newAccount("d"), { A: 1 }, fresh), []);
});
