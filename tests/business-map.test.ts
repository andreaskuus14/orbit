import { test } from "node:test";
import assert from "node:assert/strict";
import { DUE_COLOR, STAGE_COLOR, STAGE_RADIUS, idAngle, mapNodes, mapSummary, pulse } from "../src/lib/business-map-pure.ts";
import { STAGES } from "../src/lib/business-pure.ts";

test("rings go from lead outside to paying inside, lost beyond them all", () => {
  const order = STAGES.filter((s) => s !== "lost").map((s) => STAGE_RADIUS[s]);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] < order[i - 1]);
  assert.ok(STAGE_RADIUS.lost > STAGE_RADIUS.lead);
});

test("idAngle is deterministic, in range and spreads ids", () => {
  assert.equal(idAngle("abc"), idAngle("abc"));
  const angles = ["a", "b", "c", "", "x".repeat(500), "ü-🙂"].map(idAngle);
  for (const a of angles) assert.ok(a >= 0 && a < Math.PI * 2);
  assert.notEqual(idAngle("a"), idAngle("b"));
});

test("mapNodes puts each node on its stage ring with stage or due colour", () => {
  const ps = [{ id: "1", name: "Bakery", stage: "pilot" as const }, { id: "2", name: "Salon", stage: "contacted" as const }, { id: "3", name: "Gone", stage: "lost" as const }];
  const [a, b, c] = mapNodes(ps, new Set(["2", "3"]));
  assert.ok(Math.abs(Math.hypot(a.x, a.z) - STAGE_RADIUS.pilot) < 1e-9);
  assert.equal(a.color, STAGE_COLOR.pilot); assert.equal(a.due, false);
  assert.equal(b.color, DUE_COLOR); assert.equal(b.due, true);
  assert.equal(c.due, false); assert.equal(c.color, STAGE_COLOR.lost);
  assert.deepEqual(mapNodes(ps, new Set()).map((n) => [n.x, n.z]), mapNodes(ps, new Set()).map((n) => [n.x, n.z]));
  const odd = mapNodes([{ id: "z", name: "?", stage: "won" as never }], new Set())[0];
  assert.equal(odd.stage, "lead"); assert.ok(Number.isFinite(odd.x) && Number.isFinite(odd.z));
});

test("pulse stays finite and still under reduced motion", () => {
  for (const t of [0, 1.3, 1e9, NaN, Infinity]) { const v = pulse(t, false); assert.ok(Number.isFinite(v) && v >= 1 && v <= 1.5); }
  assert.equal(pulse(5, true), pulse(9, true));
});

test("mapSummary counts per stage and due", () => {
  assert.equal(mapSummary([]), "Pipeline map: no businesses yet.");
  assert.equal(mapSummary([{ stage: "lead", due: false }, { stage: "lead", due: false }, { stage: "contacted", due: true }]),
    "Pipeline map: 2 To contact, 1 Contacted; 1 follow-up due.");
});
