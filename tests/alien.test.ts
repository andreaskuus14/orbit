import { test } from "node:test";
import assert from "node:assert/strict";
import { armCount, filamentPairs, shellCount } from "../src/lib/alien-pure.ts";

test("alien: filament web links every planet to the CORE, no dupes or self-links", () => {
  const n = 13, pairs = filamentPairs(n);
  const keys = pairs.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`);
  assert.equal(new Set(keys).size, pairs.length);
  for (const [a, b] of pairs) { assert.notEqual(a, b); assert.ok(a >= 0 && b >= 0 && a <= n && b <= n); }
  for (let i = 1; i <= n; i++) assert.ok(keys.includes(`0-${i}`));
  assert.ok(pairs.length <= 14 * 3); // fits the shader's fixed budget
  assert.deepEqual(filamentPairs(0), []);
});

test("alien: particle budgets are clamped and grow with quality", () => {
  for (const f of [armCount, shellCount]) {
    assert.equal(f(-5), f(0)); assert.equal(f(9), f(3)); assert.equal(f(NaN), f(0));
    assert.ok(f(0) <= f(1) && f(1) <= f(2) && f(2) <= f(3));
  }
});

import { einsteinRadius, planetDetail, tesseractAngle } from "../src/lib/alien-pure.ts";

test("alien: lens radius is finite, shrinks with distance and is clamped", () => {
  assert.ok(einsteinRadius(5, 46, 50) > einsteinRadius(5, 90, 50));
  assert.equal(einsteinRadius(5, 0, 50), 0.32);
  for (const x of [NaN, Infinity, -1]) assert.ok(Number.isFinite(einsteinRadius(5, x, 50)));
  assert.equal(einsteinRadius(NaN, 10, 50), 0);
});

test("alien: planet detail grows as the camera closes in and is capped by quality", () => {
  assert.equal(planetDetail(1, 40, 3), 0);
  assert.ok(planetDetail(1, 3, 3) > 0.9);
  assert.equal(planetDetail(1, 3, 0), 0);
  assert.ok(planetDetail(1, 3, 1) <= 0.5);
  assert.ok(planetDetail(1, 6, 3) < planetDetail(1, 4, 3));
  for (const x of [NaN, 0, -2]) { const d = planetDetail(1, x, 3); assert.ok(d >= 0 && d <= 1); }
});

test("alien: tesseract angles are finite and frozen for reduced motion", () => {
  for (const p of [0, 1] as const) {
    assert.equal(tesseractAngle(100, p, true), tesseractAngle(5, p, true));
    assert.ok(Number.isFinite(tesseractAngle(NaN, p, false)));
    assert.ok(tesseractAngle(1e9, p, false) < Math.PI * 2);
  }
});

import { overviewBoost } from "../src/lib/alien-pure.ts";

test("alien: far worlds get a size floor, near ones keep true size", () => {
  assert.equal(overviewBoost(0.6, 3, 50), 1);
  assert.ok(overviewBoost(0.6, 80, 50) > 1.5);
  assert.equal(overviewBoost(0.6, 1e9, 50), 2.6);
  for (const x of [NaN, 0, -4]) { const b = overviewBoost(0.6, x, 50); assert.ok(b >= 1 && b <= 2.6); }
});
