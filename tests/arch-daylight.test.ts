import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, starterScene, type Op, type Part } from "../src/lib/arch-pure.ts";
import { daylightPlan, rayHitsBox, studyMonth, summarize, windowSees } from "../src/lib/arch-daylight-pure.ts";

const TALLINN = { lat: 59.437, lon: 24.754 };
const build = (ops: Op[], noRoof = true) => {
  let n = 0;
  const parts = applyOps(starterScene(), ops, () => `x${++n}`).scene.parts;
  return noRoof ? parts.filter((p) => p.kind !== "roof") : parts;
};
const hoursOf = (parts: Part[], month: number) => {
  const plan = daylightPlan(parts), m = studyMonth(plan, TALLINN, month);
  return Object.fromEntries(plan.rooms.map((r) => [r.name, m.lit[r.id].map((v, h) => (v ? h : -1)).filter((h) => h >= 0)]));
};

test("ray/box: hits in front, misses behind and beside", () => {
  const b = { x0: -1, x1: 1, y0: 0, y1: 2, z0: -1, z1: 1 };
  assert.equal(rayHitsBox([0, 1, 5], [0, 0, -1], b), true);
  assert.equal(rayHitsBox([0, 1, 5], [0, 0, 1], b), false);
  assert.equal(rayHitsBox([3, 1, 5], [0, 0, -1], b), false);
  assert.equal(rayHitsBox([0, 1, 5], [0, 1, -1].map((v) => v / Math.SQRT2) as [number, number, number], b), false); // passes over the top
});

test("rooms: the starter shell is one room; an interior wall splits it in two", () => {
  const one = daylightPlan(build([]));
  assert.equal(one.rooms.length, 1);
  assert.ok(Math.abs(one.rooms[0].area - 9.4 * 7.4) < 4, `area ${one.rooms[0].area}`); // grid cells are coarse
  const two = daylightPlan(build([{ op: "add", kind: "wall", x: 0, z: 0, y: 0.2, w: 9.4, d: 0.2, h: 2.8 }]));
  assert.deepEqual(two.rooms.map((r) => r.name), ["Floor 1 · room A", "Floor 1 · room B"]); // A north, B south
  assert.ok(two.rooms.every((r) => r.area > 25 && r.area < 40));
});

test("windows join the room behind them; daylight factor is WFR ÷ 5", () => {
  const plan = daylightPlan(build([{ op: "add", kind: "wall", x: 0, z: 0, y: 0.2, w: 9.4, d: 0.2, h: 2.8 },
    { op: "add", kind: "window", host: "p3", face: "s", w: 2, h: 1.5 }]));
  const south = plan.rooms.find((r) => r.name.endsWith("B"))!;
  assert.deepEqual(south.windows.length, 1);
  assert.equal(south.glazing, 3);
  const [res] = summarize(plan, []).filter((r) => r.id === south.id);
  assert.ok(Math.abs(res.df - (3 / south.area) * 20) < 0.06);
});

// Hand check, Tallinn 59.44° N, solar time. June 21 (δ +23.44°): the sun is due east/west at hour angle acos(tan δ / tan φ) =
// 75.2° = 5.0 h from noon, so a south wall sees it 07:00–17:00 → the 10 samples at 07:30…16:30. Dec 21 (δ −23.44°): sunrise at
// acos(−tan φ tan δ) = 42.7° = 2.85 h before noon → up 09:09–14:51 → 6 samples (09:30…14:30), max height 7°, all from the south.
test("south window, Tallinn: 10 sun hours on June 21, 6 on December 21", () => {
  const parts = build([{ op: "add", kind: "window", host: "p3", face: "s", w: 1.2 }]);
  assert.deepEqual(hoursOf(parts, 5)["Floor 1 · room A"], [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(hoursOf(parts, 11)["Floor 1 · room A"], [9, 10, 11, 12, 13, 14]);
});

test("north window gets no December sun; flagged in the summary", () => {
  const parts = build([{ op: "add", kind: "window", host: "p3", face: "n", w: 1.2 }]);
  const plan = daylightPlan(parts), months = Array.from({ length: 12 }, (_, m) => studyMonth(plan, TALLINN, m));
  const [r] = summarize(plan, months);
  assert.equal(r.decHours, 0);
  assert.equal(r.noDecSun, true);
  assert.ok(r.junHours > 0 && r.junHours < 10); // early morning and evening sun from the NE/NW
  assert.ok(r.annualHours > 0);
});

test("a 3 m wall 5 m south blocks the low December sun but not June noon", () => {
  const parts = build([{ op: "add", kind: "window", host: "p3", face: "s", w: 1.2 }, { op: "add", kind: "wall", x: 0, z: 9, y: 0, w: 30, d: 0.3, h: 3 }]);
  assert.deepEqual(hoursOf(parts, 11)["Floor 1 · room A"], []);
  assert.ok(hoursOf(parts, 5)["Floor 1 · room A"].includes(12));
});

test("windowSees ignores sun behind the wall or under the horizon", () => {
  const win = { id: "w", room: "r", x: 0, y: 1, z: 4, w: 1, h: 1, face: "s" as const };
  assert.equal(windowSees(win, { x: 0, y: 0.5, z: -0.866 }, []), false); // from the north
  assert.equal(windowSees(win, { x: 0, y: -0.1, z: 0.99 }, []), false);
  assert.equal(windowSees(win, { x: 0, y: 0.5, z: 0.866 }, []), true);
});

test("the starter roof (as a box, 0.5 m eave) still lets the low December sun in", () => {
  const roofed = build([{ op: "add", kind: "window", host: "p3", face: "s", w: 1.2 }], false);
  assert.equal(hoursOf(roofed, 11)["Floor 1 · room A"].length, 6);
});
