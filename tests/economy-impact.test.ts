import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOne, compareEconomies, diffInputs, impactLines } from "../src/lib/economy-impact-pure.ts";
import type { Economy } from "../src/lib/economy-pure.ts";

const BASE: Economy = {
  rate: 1, slots: 1,
  eggs: [{ name: "A", price: 60 }, { name: "B", price: 600 }, { name: "C", price: 1_000_000 }],
  pets: [{ name: "a", egg: "A", rarity: "common", chance: 1, cps: 1 }, { name: "b", egg: "B", rarity: "common", chance: 1, cps: 3 }, { name: "c", egg: "C", rarity: "common", chance: 1, cps: 10 }],
};
const PROP: Economy = { ...BASE, rate: 2, eggs: BASE.eggs.map((g) => (g.name === "C" ? { ...g, price: 6000 } : g)) };
const O = { players: 20, seed: 1, capMin: 600 };

test("diffInputs names every changed input; applyOne changes only that one", () => {
  assert.deepEqual(diffInputs(BASE, PROP).map((c) => c.key), ["rate", "egg:C"]);
  assert.match(diffInputs(BASE, PROP, "et")[0].label, /põhi-mündimäär 1 → 2/);
  assert.equal(applyOne(BASE, PROP, "rate").eggs[2].price, 1_000_000);
  assert.equal(applyOne(BASE, PROP, "egg:C").rate, 1);
  assert.deepEqual(diffInputs(BASE, BASE), []);
});

test("compareEconomies: calculated, simulated and playtest rows stay separate, each names the inputs", () => {
  const i = compareEconomies(BASE, PROP, [{ metric: "firstUpgrade", side: "base", value: 1.5 }], O);
  const calc = i.rows.find((r) => r.source === "calculated" && r.metric === "firstUpgrade")!;
  assert.deepEqual([calc.base, calc.proposed], [1, 0.5]);
  assert.ok(i.rows.every((r) => r.inputs.length === 2));
  const pt = i.rows.filter((r) => r.source === "playtest");
  assert.equal(pt.length, 1);
  assert.equal(pt[0].proposed, null); // never filled from the simulation
  assert.ok(i.bottlenecks.base.some((b) => b.startsWith("C")));
  assert.ok(i.bottlenecks.base[0].includes("0%") && !i.bottlenecks.proposed.some((b) => b.includes("0%")));
  const s = i.sensitivity.find((x) => x.input.startsWith("egg C"))!;
  assert.equal(s.firstUpgrade, 0); // the C price does not move the first egg
  const lines = impactLines(i, "et");
  assert.ok(lines.includes("[Arvutatud]") && lines.includes("[Simuleeritud personad]") && lines.includes("[Sinu mängutest]"));
});

test("no playtest rows without his measurements", () => {
  assert.ok(!compareEconomies(BASE, BASE, [], O).rows.some((r) => r.source === "playtest"));
});
