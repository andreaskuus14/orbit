// Property-based tests (fast-check, MIT) for the Roblox pet-sim economy tools: egg balancer, currency simulator, price proposals,
// the change-impact report and the coin abbreviation shared with the generated Luau UI kit (tests/luau/ checks the Luau side).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { nice, playOne, roll, rng, simulate, type Economy, type Pet } from "../src/lib/economy-pure.ts";
import { MAX_BUYS, playOne as simPlayer, simulateModel, type Model } from "../src/lib/economy-sim-pure.ts";
import { compareEconomies, impactLines } from "../src/lib/economy-impact-pure.ts";
import { abbrev } from "../src/lib/gamedev-uikit-pure.ts";

const economy: fc.Arbitrary<Economy> = fc.record({
  rate: fc.integer({ min: 1, max: 50 }),
  slots: fc.integer({ min: 1, max: 5 }),
  eggs: fc.array(fc.integer({ min: 10, max: 200_000 }), { minLength: 1, maxLength: 5 }).map((ps) => ps.map((price, i) => ({ name: `Egg${i}`, price }))),
}).chain((e) => fc.tuple(...e.eggs.map((g) => fc.array(fc.record({ chance: fc.integer({ min: 1, max: 90 }), cps: fc.integer({ min: 0, max: 500 }) }), { minLength: 1, maxLength: 4 })
  .map((ps) => ps.map((p, j): Pet => ({ name: `${g.name}-p${j}`, egg: g.name, rarity: "common", chance: p.chance, cps: p.cps }))))).map((pets) => ({ ...e, pets: pets.flat() })));

test("egg balancer: a player's eggs unlock in order, income never drops, and the same seed replays the same run", () => {
  fc.assert(fc.property(economy, fc.nat(), fc.constantFrom({ coinMult: 1, luck: 1 }, { coinMult: 4, luck: 3 }), (e, seed, s) => {
    const run = playOne(e, s, rng(seed), 600);
    let lastT = 0, lastInc = 0, done = true;
    run.unlock.forEach((t, k) => {
      if (t === null) { done = false; return; }
      assert.ok(done, "no egg unlocks after one that never did");
      assert.ok(t >= lastT - 1e-9 && t <= 600 + 1e-9, `egg ${k} at ${t} min`);
      assert.ok(run.income[k]! >= lastInc - 1e-9, "income never goes down");
      lastT = t; lastInc = run.income[k]!;
    });
    assert.deepEqual(playOne(e, s, rng(seed), 600), run);
  }), { numRuns: 1500 });
});

test("egg balancer summary: shares are 0–100 %, the median player is never slower than the 90th percentile", () => {
  fc.assert(fc.property(economy, fc.nat(1000), (e, seed) => {
    for (const p of simulate(e, { players: 20, seed, capMin: 300 })) for (const x of p.eggs) {
      assert.ok(x.reached >= 0 && x.reached <= 100);
      if (x.median !== null) assert.ok(x.p90 !== null && x.median <= x.p90 + 1e-9);
    }
  }), { numRuns: 200 });
});

test("a hatch always gives a pet from that egg, whatever the luck", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }), fc.double({ min: 0, max: 0.999999, noNaN: true }), fc.integer({ min: 1, max: 10 }), (cs, u, luck) => {
    const pets = cs.map((chance, i): Pet => ({ name: `p${i}`, egg: "E", rarity: "c", chance, cps: i }));
    assert.ok(pets.includes(roll(pets, luck, () => u)));
  }), { numRuns: 2000 });
});

test("price proposals read like prices (two significant figures) and stay within 5 % of the exact number", () => {
  fc.assert(fc.property(fc.double({ min: 0.5, max: 1e12, noNaN: true }), (x) => {
    const n = nice(x);
    assert.ok(n >= 1 && Number.isFinite(n));
    if (x >= 10) assert.ok(Math.abs(n - x) / x <= 0.05 + 1e-12, `${x} → ${n}`);
    const digits = String(Math.round(n)).replace(/0+$/, "");
    if (n >= 10) assert.ok(digits.length <= 2, `${n} has more than 2 significant figures`);
  }), { numRuns: 3000 });
});

const model: fc.Arbitrary<Model> = fc.record({
  currency: fc.constant("Coins"),
  sources: fc.array(fc.record({ name: fc.constantFrom("Click", "Pets"), amount: fc.integer({ min: 1, max: 100 }), every: fc.integer({ min: 1, max: 60 }) }), { minLength: 1, maxLength: 3 }),
  rewards: fc.array(fc.record({ name: fc.constant("Gift"), amount: fc.integer({ min: 1, max: 5000 }), at: fc.integer({ min: 0, max: 60 }), repeat: fc.integer({ min: 0, max: 30 }) }), { maxLength: 2 }),
  sinks: fc.uniqueArray(fc.record({ name: fc.constantFrom("Speed", "Area", "Golden pet", "Ocean"), price: fc.integer({ min: 1, max: 100_000 }), growth: fc.constantFrom(0, 1, 1.5, 3), boost: fc.integer({ min: 0, max: 50 }) }), { selector: (s) => s.name, minLength: 1, maxLength: 4 }),
  session: fc.integer({ min: 1, max: 30 }), sessions: fc.integer({ min: 1, max: 3 }),
});

test("currency simulator: buying never creates coins (balance = earned + rewards − spent), the balance never goes below zero", () => {
  fc.assert(fc.property(model, fc.nat(), fc.nat(50), (m, seed, player) => {
    const r = simPlayer(m, seed, player), spent = Object.values(r.spent).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(r.balance - (r.earned + r.rewarded - spent)) <= 1e-6 * Math.max(1, r.earned + r.rewarded), "coins are conserved");
    assert.ok(r.balance >= -1e-6);
    for (const e of r.events) assert.ok(e.balance >= 0, `${e.name} at ${e.min} min left ${e.balance}`);
    const once = m.sinks.filter((s) => s.growth < 1).map((s) => s.name);
    for (const n of once) assert.ok(r.events.filter((e) => e.kind === "buy" && e.name === n).length <= 1, `one-off ${n} bought twice`);
    assert.deepEqual(simPlayer(m, seed, player), r, "same seed, same player");
  }), { numRuns: 400 });
});

test("regression: a rebuyable sink at the same price with a boost ('sink, Speed, 1, 1, 10') never finished and ran ORBIT out of memory", () => {
  const m: Model = { currency: "Coins", sources: [{ name: "Click", amount: 2, every: 1 }], rewards: [], sinks: [{ name: "Speed", price: 1, growth: 1, boost: 10 }], session: 20, sessions: 1 };
  const t = Date.now(), r = simPlayer(m, 1, 0);
  assert.equal(r.events.length, MAX_BUYS);
  assert.ok(Date.now() - t < 5000);
  assert.ok(Math.abs(r.balance - (r.earned - r.spent.Speed)) < 1e-6 * r.earned);
});

test("currency simulator summary: spend shares never pass 100 %, reached is 0–100 %", () => {
  fc.assert(fc.property(model, fc.nat(), (m, seed) => {
    const r = simulateModel(m, { players: 10, seed });
    assert.ok(r.sinks.reduce((a, s) => a + s.share, 0) <= 100 + r.sinks.length, "rounded shares add up to about 100 %");
    for (const s of r.sinks) assert.ok(s.reached >= 0 && s.reached <= 100 && s.share >= 0);
  }), { numRuns: 150 });
});

test("regression: the change-impact text listed the bottlenecks and sensitivity twice", () => {
  const e: Economy = { rate: 2, slots: 3, eggs: [{ name: "A", price: 50 }, { name: "B", price: 900_000 }], pets: [{ name: "Dog", egg: "A", rarity: "c", chance: 100, cps: 1 }, { name: "Fox", egg: "B", rarity: "c", chance: 100, cps: 5 }] };
  const lines = impactLines(compareEconomies(e, { ...e, rate: 3 }, [], { players: 20, seed: 1, capMin: 120 }));
  assert.equal(lines.filter((l) => l.startsWith("Bottlenecks")).length, 1);
  assert.equal(lines.filter((l) => l.startsWith("Sensitivity")).length, 1);
});

// ---- coin labels ----

/** The exact label by string arithmetic: truncate (never round up) to one decimal at the unit. */
const exactAbbrev = (n: number) => {
  const units = ["", "K", "M", "B", "T"], a = BigInt(Math.abs(n));
  let i = 0, p = 1n;
  while (a >= p * 1000n && i < units.length - 1) { p *= 1000n; i++; }
  const s = i === 0 ? String(a) : `${a / p}${(a * 10n / p) % 10n ? `.${(a * 10n / p) % 10n}` : ""}`;
  return `${n < 0 ? "-" : ""}${s}${units[i]}`;
};

test("coin labels: 1234 → 1.2K, never rounded up (999,999 is 999.9K, not 1000K), same rule for every size", () => {
  fc.assert(fc.property(fc.oneof(fc.integer({ min: -2_000_000, max: 2_000_000 }), fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.integer({ min: 1, max: 999 }).chain((h) => fc.constantFrom(h * 1e3, h * 1e6, h * 1e9, h * 1e12, h * 1e3 + 999, h * 1e6 - 1))), (n) => {
    assert.equal(abbrev(n), exactAbbrev(n), String(n));
  }), { numRuns: 5000 });
});
