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
