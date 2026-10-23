import { test } from "node:test";
import assert from "node:assert/strict";
import { expDamp } from "../src/lib/smooth-damp-pure.ts";
import { clampDrag, magnet } from "../src/lib/motion-pure.ts";

test("expDamp keeps exp(-dt/tau) of the gap: ~0.884 per 60 fps frame at tau 0.135 s", () => {
  const x = expDamp(0, 100, 0.135, 1 / 60);
  assert.ok(Math.abs((100 - x) / 100 - 0.884) < 0.002);
});

test("expDamp never overshoots and is frame-rate independent", () => {
  let a = 0, b = 0, prev = 0;
  for (let i = 0; i < 120; i++) { a = expDamp(a, 1, 0.12, 1 / 120); assert.ok(a <= 1 && a >= prev); prev = a; }
  for (let i = 0; i < 30; i++) b = expDamp(b, 1, 0.12, 1 / 30);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(1 - a < 1e-3);
});

test("expDamp is finite on bad input", () => {
  assert.equal(expDamp(NaN, 2, 0.1, 0.016), 2);
  assert.equal(expDamp(3, NaN, 0.1, 0.016), 3);
  assert.equal(expDamp(3, 5, 0, 0.016), 5); // tau 0 = snap
  assert.equal(expDamp(3, 5, 0.1, -1), 3);
  assert.equal(expDamp(3, 5, 0.1, NaN), 3);
});

test("magnet pulls a fraction toward the centre, capped", () => {
  const o = { x: 0, y: 0 };
  assert.deepEqual(magnet(0, 0, 10, 0, 0.3, 99, o), { x: 3, y: 0 });
  magnet(0, 0, 100, 0, 0.5, 8, o);
  assert.ok(Math.abs(o.x - 8) < 1e-9 && o.y === 0);
  magnet(5, 5, NaN, 0, 0.5, 8, o);
  assert.deepEqual(o, { x: 5, y: 5 });
});

test("clampDrag keeps the header reachable", () => {
  const box = { left: 900, top: 72, width: 480, height: 600 };
  assert.deepEqual(clampDrag(-100, 20, box, 1440, 900), { x: -100, y: 20 });
  assert.deepEqual(clampDrag(5000, 5000, box, 1440, 900), { x: 1440 - 64 - 900, y: 900 - 64 - 72 });
  assert.deepEqual(clampDrag(-5000, -5000, box, 1440, 900), { x: 64 - 900 - 480, y: -72 });
  assert.deepEqual(clampDrag(NaN, 10, box, 1440, 900), { x: 0, y: 10 });
});
