// Property-based tests (fast-check, MIT) for prices ORBIT proposes: negotiation offers and webshop variant prices.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { amountsIn, makeDraft, outsideLimits, planNext, approveProblem, type Limits, type Negotiation, type Side, type Turn } from "../src/lib/negotiator-pure.ts";
import { MIN_MARGIN, floorPrice, variantsFor } from "../src/lib/launch-pure.ts";
import { marginOf, type Margin } from "../src/lib/niche-pure.ts";

const NOW = Date.parse("2026-10-26T10:00:00Z");
const fmt = (n: number) => `€${Number.isInteger(n) ? n : n.toFixed(2)}`; // as the negotiator writes a price

const limits = fc.tuple(fc.integer({ min: 100, max: 100_000_000 }), fc.integer({ min: 0, max: 50_000_000 }), fc.integer({ min: 1, max: 25 }))
  .map(([f, span, stepPct]): Limits => ({ floor: f / 100, ceiling: (f + span) / 100, deadline: null, mustHaves: [], walkAway: "", stepPct }));
const nego = (side: Side, l: Limits, turns: Turn[] = []): Negotiation => ({ id: "n", ref: "prospect:x", side, title: "x", limits: l, state: "talking", turns, draft: null, created: "", updated: "" });

test("every amount ORBIT writes as a price reads back as that price (the draft check can't miss or misread it)", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 100_000_000 }), (c) => {
    const p = c / 100;
    assert.ok(amountsIn(`I can do ${fmt(p)} per month.`).includes(p), fmt(p));
    assert.deepEqual(amountsIn(`Price: ${fmt(p)}`), [p]);
  }), { numRuns: 3000 });
});

test("a whole negotiation (fast-check found a €110.01 concession on a €110 step, floor 1, ceiling 10969.01, 1 %): every planned price stays within his floor–ceiling, concessions only move toward his limit, one step at most", () => {
  const reply = fc.record({ intent: fc.constantFrom("counter", "counter", "objection", "interested"), at: fc.double({ min: -0.5, max: 1.5, noNaN: true }) });
  fc.assert(fc.property(fc.constantFrom<Side>("sell", "buy"), limits, fc.array(reply, { minLength: 1, maxLength: 15 }), (side, l, replies) => {
    let n = nego(side, l), mine: number | null = null;
    const d = side === "sell" ? 1 : -1, anchor = side === "sell" ? l.ceiling : l.floor;
    const step = Math.max(1, Math.round((anchor * l.stepPct) / 100));
    for (const r of replies) {
      const theirs = r.intent === "counter" ? Math.round((l.floor + (l.ceiling - l.floor) * r.at) * 100) / 100 : null;
      if (theirs !== null && theirs <= 0) continue;
      n = { ...n, turns: [...n.turns, { at: "", from: "them", text: "", price: theirs, intent: r.intent as Turn["intent"] }] };
      const p = planNext(n, r.intent as "counter", theirs, NOW);
      if (p.price !== null) {
        if (p.action === "accept") {
          assert.ok(theirs !== null && p.price === theirs, `accepts exactly what they offered (${theirs}), got ${p.price}`);
          assert.ok(d * p.price >= d * (side === "sell" ? l.floor : l.ceiling), "never accepts worse than his limit");
        } else {
          assert.ok(p.price >= l.floor && p.price <= l.ceiling, `${p.action} ${p.price} outside ${l.floor}–${l.ceiling}`);
          if (mine !== null) {
            assert.ok(d * p.price <= d * mine, "an offer never goes back up past his last one");
            assert.ok(Math.abs(mine - p.price) <= step + 1e-9, `conceded ${mine} → ${p.price}, more than one step (${step})`);
          }
        }
      }
      if (p.state !== "talking") break;
      if (p.price !== null) { n = { ...n, turns: [...n.turns, { at: "", from: "me", text: "", price: p.price }] }; mine = p.price; }
    }
  }), { numRuns: 3000 });
});

test("regression: a seller asking €40 when his floor is €50 is accepted at €40, not at €50 (ORBIT offered to pay more than asked)", () => {
  const l: Limits = { floor: 50, ceiling: 100, deadline: null, mustHaves: [], walkAway: "", stepPct: 5 };
  const n = nego("buy", l, [{ at: "", from: "them", text: "how about €40", price: 40, intent: "counter" }]);
  const p = planNext(n, "counter", 40, NOW);
  assert.deepEqual([p.action, p.price], ["accept", 40]);
  const draft = makeDraft("Deal, €40 works for me.", p, "counter", l, NOW);
  assert.equal(typeof draft, "object", String(draft)); // the planned price itself passes the limits check
  assert.equal(approveProblem({ ...n, draft: draft as Exclude<typeof draft, string> }, (draft as { at: string }).at), "");
  assert.deepEqual(outsideLimits("Deal at €30", l), ["€30"], "any other amount outside the limits is still caught");
  assert.equal(typeof makeDraft("Deal, €40 works. Or €30?", p, "counter", l, NOW), "string");
  // the sell side, same rule: they offer €1500 for a €800–1000 fee → accept €1500
  const s = nego("sell", { ...l, floor: 800, ceiling: 1000 }, [{ at: "", from: "them", text: "we can do €1500", price: 1500, intent: "counter" }]);
  assert.equal(planNext(s, "counter", 1500, NOW).price, 1500);
});

// ---- webshop variant prices ----

const margin = fc.record({
  price: fc.integer({ min: 100, max: 100_000 }).map((c) => c / 100),
  cogs: fc.integer({ min: 0, max: 30_000 }).map((c) => c / 100),
  shipping: fc.integer({ min: 0, max: 2000 }).map((c) => c / 100),
  feePct: fc.integer({ min: 0, max: 30 }).map((p) => p / 100),
  cac: fc.integer({ min: 0, max: 5000 }).map((c) => c / 100),
});
const exactLeft = (m: Margin, price: number, qty: number) => price - m.cogs * qty - m.shipping - price * m.feePct - m.cac;

test("every webshop price leaves at least 20 % of itself after costs, fees and ads; raised and pack prices end in .99", () => {
  fc.assert(fc.property(margin, fc.integer({ min: 99, max: 100_000 }).map((c) => c / 100), (m, wanted) => {
    for (const v of variantsFor(wanted, m)) {
      if (v.raised || v.qty > 1) assert.match(v.price.toFixed(2), /\.99$/, `${v.option} ${v.price}`);
      assert.ok(Math.abs(v.price * 100 - Math.round(v.price * 100)) < 1e-6, "a whole number of cents");
      assert.ok(exactLeft(m, v.price, v.qty) >= MIN_MARGIN * v.price - 1e-9, `${v.option} at €${v.price} leaves ${exactLeft(m, v.price, v.qty).toFixed(4)}`);
      assert.ok(v.price >= wanted || v.qty > 1, "the single is never priced under what he asked");
      assert.equal(v.profit, marginOf({ ...m, price: v.price, cogs: m.cogs * v.qty }).unit);
    }
  }), { numRuns: 3000 });
});

test("regression: costs needing exactly €13.00 (or a 3-pack needing €435.00) got €12.99 / €434.99, just under the 20 % margin floor", () => {
  const m: Margin = { price: 1, cogs: 7.4, shipping: 0, feePct: 0.3, cac: 0.4 }; // (7.40 + 0.40) / (1 − 0.30 − 0.20) = 15.60
  assert.ok(exactLeft(m, floorPrice(m), 1) >= MIN_MARGIN * floorPrice(m) - 1e-9);
  const k: Margin = { price: 1, cogs: 6.5, shipping: 0, feePct: 0, cac: 0 }; // 6.50 / 0.8 = 8.125 → 8.99 fine; 10.40 / 0.8 = 13.00 exactly:
  assert.equal(floorPrice({ ...k, cogs: 10.4 }), 13.99);
  const pack: Margin = { price: 1, cogs: 107.44, shipping: 7.2, feePct: 0.02, cac: 9.78 }; // fast-check counterexample: 3-pack needs €435.00
  assert.equal(variantsFor(0.99, pack)[1]?.price ?? floorPrice(pack, 3), 435.99);
  assert.equal(floorPrice({ ...k, cogs: 10.392 }), 12.99); // needs 12.99 exactly → 12.99 (not 13.99)
});

test("regression: a 1 % step on a €10,969.01 anchor conceded €110.01 (more than the €110 step); now €109.01 to a whole €10,860", () => {
  const l: Limits = { floor: 1, ceiling: 10969.01, deadline: null, mustHaves: [], walkAway: "", stepPct: 1 };
  const n = nego("sell", l, [{ at: "", from: "them", text: "", price: 1, intent: "counter" }, { at: "", from: "me", text: "", price: 10969.01 }, { at: "", from: "them", text: "", price: 1, intent: "counter" }]);
  assert.equal(planNext(n, "counter", 1, NOW).price, 10860);
});
