import { test } from "node:test";
import assert from "node:assert/strict";
import { aberrationFor, damp, fmtCoord, idleDrift, scramble, stepZoom, wheelKick } from "../src/lib/cinematic-pure.ts";

test("damp approaches the target and is frame-rate independent", () => {
  assert.equal(damp(0, 10, 5, 0), 0);
  const one = damp(0, 10, 5, 0.1);
  const two = damp(damp(0, 10, 5, 0.05), 10, 5, 0.05);
  assert.ok(Math.abs(one - two) < 1e-9);
  assert.ok(damp(0, 10, 5, 10) > 9.999);
});

test("wheel kicks normalise modes and cap flings", () => {
  assert.ok(wheelKick(100) > 0 && wheelKick(-100) < 0);
  assert.equal(wheelKick(1, 1), wheelKick(16));
  assert.equal(wheelKick(100000), wheelKick(160));
  assert.equal(wheelKick(NaN), 0);
});

test("zoom inertia eases to rest and stops at the limits", () => {
  let s = { dist: 40, vel: 1 };
  for (let i = 0; i < 120; i++) s = stepZoom(s.dist, s.vel, 1 / 60, 4, 80);
  assert.equal(s.vel, 0);
  assert.ok(s.dist > 40 && s.dist < 80);
  const hit = stepZoom(79, 5, 0.1, 4, 80);
  assert.deepEqual(hit, { dist: 80, vel: 0 });
  const hitch = stepZoom(40, 1, 5, 4, 80); // a 5 s hitch is clamped to 0.1 s
  assert.ok(hitch.dist < 40 * Math.exp(0.11));
});

test("idle drift waits, then eases in to its max", () => {
  assert.equal(idleDrift(3), 0);
  assert.equal(idleDrift(8), 0);
  assert.ok(idleDrift(9) > 0 && idleDrift(9) < idleDrift(11));
  assert.equal(idleDrift(60), 0.18);
});

test("aberration is zero at rest and saturates on fast moves", () => {
  assert.equal(aberrationFor(0), 0);
  assert.equal(aberrationFor(0.03), 0);
  assert.equal(aberrationFor(NaN), 0);
  assert.ok(aberrationFor(0.5) > 0);
  assert.ok(aberrationFor(100) <= 0.0022 && aberrationFor(100) > 0.0021);
  assert.equal(aberrationFor(0.14), 0); // following an inner planet: no fringe
});

test("scramble is deterministic, keeps spaces and resolves to the text", () => {
  const t = "// ORBIT OS";
  assert.equal(scramble(t, 1), t);
  assert.equal(scramble(t, 0, 7), scramble(t, 0, 7));
  assert.notEqual(scramble("ABCDEFGHIJ", 0, 1), scramble("ABCDEFGHIJ", 0, 2));
  const s = scramble(t, 0, 3);
  assert.equal(s.length, t.length);
  assert.equal(s.slice(0, 3), "// "); // punctuation and spaces stay put
  assert.equal(scramble("MEMORY", 0.5, 4).slice(0, 3), "MEM");
});

test("coordinates are fixed width with a sign", () => {
  assert.equal(fmtCoord(4.213), "+004.21");
  assert.equal(fmtCoord(-12), "-012.00");
  assert.equal(fmtCoord(NaN), "+000.00");
});
