import { test } from "node:test";
import assert from "node:assert/strict";
import { smoothDamp, smoothDampVec } from "../src/lib/smooth-damp-pure.ts";

test("smoothDamp eases in, arrives without overshoot", () => {
  const vel = { v: 0 };
  let x = 0, prevStep = 0, accel = true;
  const steps: number[] = [];
  for (let i = 0; i < 240; i++) { const n = smoothDamp(x, 10, vel, 0.5, 1 / 60); steps.push(n - x); x = n; assert.ok(x <= 10); }
  assert.ok(Math.abs(x - 10) < 1e-3);
  for (let i = 1; i < 4; i++) accel &&= steps[i] > steps[i - 1]; // starts slow: velocity builds up, no jump on frame one
  assert.ok(accel);
  prevStep = steps[0];
  assert.ok(prevStep < 0.1);
});

test("smoothDamp is finite on bad input and holds with dt 0", () => {
  const vel = { v: NaN };
  assert.equal(smoothDamp(1, 1, vel, 0.3, 0), 1);
  assert.ok(Number.isFinite(smoothDamp(0, 5, vel, 0, 1 / 60)));
  assert.equal(smoothDamp(NaN, 3, vel, 0.3, 1 / 60), 3);
});

test("smoothDampVec moves every component and keeps velocity", () => {
  const p = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 300; i++) smoothDampVec(p, { x: 1, y: -2, z: 3 }, v, 0.4, 1 / 60);
  assert.ok(Math.abs(p.x - 1) < 1e-3 && Math.abs(p.y + 2) < 1e-3 && Math.abs(p.z - 3) < 1e-3);
});
