import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, starterScene, type Op } from "../src/lib/arch-pure.ts";
import { daylightPlan } from "../src/lib/arch-daylight-pure.ts";
import { ENERGY, ENERGY_INPUTS, cleanInputs, energyStudy, exteriorLength } from "../src/lib/arch-energy-pure.ts";

const TALLINN = { lat: 59.437, lon: 24.754 };
const build = (ops: Op[]) => { let n = 0; return applyOps(starterScene(), ops, () => `x${++n}`).scene.parts; };
// starter shell 10 × 8 split east–west at z = 0: A north, B south; a 2 × 1.5 window on the south face
const split = build([{ op: "add", kind: "wall", x: 0, z: 0, y: 0.2, w: 9.4, d: 0.2, h: 2.8 }, { op: "add", kind: "window", host: "p3", face: "s", w: 2, h: 1.5 }]);

test("exterior edge: a room's outdoor sides count, the shared interior wall doesn't", () => {
  const plan = daylightPlan(split), [a, b] = plan.rooms;
  for (const r of [a, b]) {
    const len = exteriorLength(r, plan.rooms), w = Math.max(...r.rects.map((q) => q.x1)) - Math.min(...r.rects.map((q) => q.x0));
    const d = Math.max(...r.rects.map((q) => q.z1)) - Math.min(...r.rects.map((q) => q.z0));
    assert.ok(Math.abs(len - (w + 2 * d)) < 0.5, `${r.name}: ${len} vs ${w + 2 * d}`);
  }
  const one = daylightPlan(build([])).rooms[0], w = 9.4, d = 7.4;
  assert.ok(Math.abs(exteriorLength(one, [one]) - 2 * (w + d)) < 1, `${exteriorLength(one, [one])}`);
});

test("sun hours at Tallinn: south room gets sun at the solstice and more at the equinox; north room none in December", () => {
  const [a, b] = energyStudy(split, TALLINN);
  assert.equal(a.sunDec, 0);
  assert.ok(b.sunDec > 3 && b.sunDec < 7, `Dec ${b.sunDec}`); // ~6 h of daylight on Dec 21 in Tallinn
  assert.ok(b.sunMar > b.sunDec && b.sunMar <= 12.5, `Mar ${b.sunMar}`);
  const turned = energyStudy(split, TALLINN, 180); // true north flipped: the window now faces north
  assert.equal(turned[1].sunDec, 0);
});

test("heat loss is U·A·ΔT plus ventilation, annual kWh from degree-days", () => {
  const [, b] = energyStudy(split, TALLINN), room = daylightPlan(split).rooms[1], U = ENERGY.u;
  const wall = exteriorLength(room, daylightPlan(split).rooms) * room.h - 3;
  const H = U.wall * wall + U.window * 3 + U.roof * room.area + U.floor * room.area + 0.33 * ENERGY.ach * room.area * room.h;
  assert.ok(Math.abs(b.hWK - H) < 0.1, `${b.hWK} vs ${H}`);
  assert.equal(b.peakW, Math.round(H * 43));
  assert.equal(b.kWh, Math.round((H * 4200 * 24) / 1000));
  assert.ok(b.kWhM2 > 20 && b.kWhM2 < 200, `${b.kWhM2} kWh/m²`); // plausible band for a small single-storey house room
});

test("two floors: roof loss only upstairs, ground loss only downstairs", () => {
  const two = build([{ op: "add", kind: "slab", x: 0, z: 0, y: 3, w: 10, d: 8, h: 0.2 }, { op: "add", kind: "wall", x: 0, z: 0, y: 3.2, w: 10, d: 8, h: 2.8 }]);
  const rows = energyStudy(two, TALLINN), [lo, hi] = rows;
  assert.equal(rows.length, 2);
  assert.ok(Math.abs(lo.hWK - hi.hWK - (ENERGY.u.floor - ENERGY.u.roof) * lo.area) < 0.5, `${lo.hWK} / ${hi.hWK}`);
  assert.deepEqual(energyStudy([], TALLINN), []);
});

test("ARC05: editable assumptions change the result predictably", () => {
  const base = energyStudy(split, TALLINN), b0 = base[1];
  const dd = energyStudy(split, TALLINN, 0, { ...ENERGY_INPUTS, degreeDays: ENERGY.degreeDays * 1.5 })[1];
  assert.ok(Math.abs(dd.kWh - 1.5 * b0.kWh) <= 1, `${dd.kWh} vs 1.5×${b0.kWh}`); // kWh ∝ degree-days
  assert.equal(dd.peakW, b0.peakW);
  const cold = energyStudy(split, TALLINN, 0, { ...ENERGY_INPUTS, design: ENERGY.design - 10 })[1];
  assert.ok(Math.abs(cold.peakW - b0.peakW - b0.hWK * 10) <= 1, "peak grows by H × 10 K");
  const leaky = energyStudy(split, TALLINN, 0, { ...ENERGY_INPUTS, uWall: ENERGY.u.wall * 2 })[1];
  assert.ok(leaky.hWK > b0.hWK && leaky.sunDec === b0.sunDec);
  assert.equal(cleanInputs({ degreeDays: -5, year: "x", ach: 1 }).degreeDays, ENERGY.degreeDays); // junk falls back
  assert.equal(cleanInputs({ ach: 1 }).ach, 1);
});
