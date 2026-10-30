import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrder, newAccount, stooqSymbol } from "../src/lib/markets-pure.ts";
import { instrument, ledger, portfolioReport, previewAlert, replayFills, simFill, statWindow, stepAlert, totalsByCurrency } from "../src/lib/markets-depth-pure.ts";

test("MKT02 instrument identity, unsupported, no substitution", () => {
  assert.deepEqual(instrument("AAPL"), { ticker: "AAPL", exchange: "NYSE/Nasdaq", currency: "USD", type: "equity/ETF", provider: "Stooq", providerId: "aapl.us" });
  for (const t of ["BRK.B", "VOD.UK", "^SPX", "SAP.DE"]) { const i = instrument(t); assert.ok(!("error" in i)); assert.equal(i.providerId, stooqSymbol(t)); }
  assert.equal((instrument("VOD.UK") as { currency: string }).currency, "GBX");
  assert.match((instrument("BTC-USD") as { error: string }).error, /crypto/);
  assert.match((instrument("SAP.FR") as { error: string }).error, /\.FR isn't supported/);
});

test("MKT02 totals never mix currencies without an FX rate + time", () => {
  const rows = [{ currency: "USD", value: 100 }, { currency: "EUR", value: 50 }, { currency: "USD", value: 1 }];
  const t = totalsByCurrency(rows);
  assert.deepEqual(t.byCurrency, { USD: 101, EUR: 50 });
  assert.equal(t.combined, null); assert.deepEqual(t.missingFx, ["EUR"]);
  const f = totalsByCurrency(rows, "USD", { EUR: { rate: 1.1, at: "2026-10-30T10:00Z", source: "test" } });
  assert.equal(f.combined, 156); assert.equal(f.fxUsed[0].at, "2026-10-30T10:00Z");
});

test("MKT03 portfolio: missing price is not zero, totals reproducible, realized + fees", () => {
  const r = portfolioReport([{ ticker: "A", shares: 2, cost: 10 }, { ticker: "B", shares: 1, cost: 5 }, { ticker: "VOD.UK", shares: 10, cost: 100 }],
    { A: { close: 12.5, date: "2026-10-29" }, "VOD.UK": { close: 110, date: "2026-10-29" } });
  assert.equal(r.rows[1].value, null);
  assert.deepEqual(r.coverage, { priced: 2, total: 3, missing: ["B"] });
  assert.deepEqual(r.value.byCurrency, { USD: 25, GBX: 1100 });
  assert.equal(r.value.combined, null, "GBX without FX");
  assert.deepEqual(r.unrealized.byCurrency, { USD: 5, GBX: 100 });
  assert.deepEqual(r.unpricedBasis.byCurrency, { USD: 5 });
  // newest first, as stored
  const l = ledger([{ at: "3", ticker: "A", side: "sell", qty: 10, price: 30, fee: 1 }, { at: "2", ticker: "A", side: "buy", qty: 10, price: 20, fee: 1 }, { at: "1", ticker: "A", side: "buy", qty: 10, price: 10, fee: 1 }]);
  assert.deepEqual(l, { realized: 150, fees: 3, method: "average cost" });
});

test("MKT04 alerts: crossing, no storm around threshold, cooldown, stale, preview", () => {
  const T = "2026-10-30", t0 = Date.parse("2026-10-30T12:00:00Z");
  let a: Parameters<typeof stepAlert>[0] = { kind: "above", value: 100 };
  let fires = 0, i = 0;
  const step = (price: number, ms = t0 + i++ * 8 * 3600_000) => { const r = stepAlert(a, { price, changePct: null, session: T }, T, ms); a = r.alert; if (r.fired) fires++; return r; };
  step(101); assert.equal(fires, 0, "already beyond at first look: no fire");
  step(99); assert.equal(fires, 0, "99 re-arms (beyond the 0.5% band)");
  for (const p of [100.1, 99.9, 100.2, 99.8, 100.05]) step(p);
  assert.equal(fires, 1, "hovering fires once");
  assert.equal(a.history?.length, 1);
  assert.equal(stepAlert({ ...a, armed: true, lastAt: new Date(t0).toISOString() }, { price: 101, changePct: null, session: T }, T, t0 + 60_000).skipped, "cooldown");
  assert.equal(stepAlert({ kind: "below", value: 5, armed: true }, { price: 1, changePct: null, session: "2026-10-20" }, T, t0).skipped, "stale");
  const m = stepAlert({ kind: "move", value: 5 }, { price: 1, changePct: -6, session: T }, T, t0);
  assert.ok(m.fired); assert.equal(stepAlert(m.alert, { price: 1, changePct: -7, session: T }, T, t0 + 7 * 3600_000).fired, null, "once per session");
  const bars = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map((date, k) => ({ date, close: [90, 101, 100.2, 95, 102][k] }));
  assert.deepEqual(previewAlert({ kind: "above", value: 100 }, bars), ["2026-10-27", "2026-10-30"]);
});

test("MKT05 stat window dates", () => {
  const bars = Array.from({ length: 40 }, (_, k) => ({ date: `2026-09-${String(k % 30 + 1).padStart(2, "0")}`, close: 10 + k }));
  assert.deepEqual(statWindow(bars, 30), { from: bars[9].date, to: bars[39].date, returns: 30 });
  assert.equal(statWindow(bars.slice(0, 2), 30), null);
});

test("MKT06 paper fills: spread/slippage/fee, deterministic replay", () => {
  const orders = [{ side: "buy" as const, qty: 10, close: 100, quoteDate: "2026-10-29" }, { side: "sell" as const, qty: 5, close: 110, quoteDate: "2026-10-30" }];
  assert.deepEqual(replayFills("s1", orders), replayFills("s1", orders));
  assert.notDeepEqual(replayFills("s1", orders), replayFills("s2", orders));
  const [b, s] = replayFills("s1", orders);
  assert.ok(b.price >= 100.05 && b.price <= 100.1, "buy pays half spread + slip");
  assert.ok(s.price <= 110 * (1 - 0.0005) && s.price >= 110 * (1 - 0.001));
  assert.equal(simFill("buy", 1, 10, "d", "x", 0).fee, 1, "min fee");
  const f = simFill("buy", 10, 100, "2026-10-29", "s1", 0);
  const r = applyOrder(newAccount("x"), { ticker: "A", side: "buy", qty: 10 }, f.price, "t", undefined, f);
  assert.ok(!("error" in r));
  assert.equal(r.account.cash, Math.round((10_000 - 10 * f.price - f.fee) * 100) / 100);
  assert.equal(r.account.fills, 1); assert.equal(r.trade.fee, f.fee); assert.equal(r.trade.fill?.quoteDate, "2026-10-29");
});
