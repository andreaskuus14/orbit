import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, edgeBorn, edgeGlow, similarEdges } from "../src/lib/memory-edges-pure.ts";

test("similarEdges links similar vectors above the threshold, ignoring scale and zero padding", () => {
  const v = [[1, 0, 0, 0], [10, 1, 0, 0], [0, 0, 1, 0], [0, 0, 2, 0.1]];
  assert.deepEqual(similarEdges(v, 0.9, 3).map(([a, b]) => [a, b]), [[0, 1], [2, 3]]);
  const [, , s] = similarEdges(v, 0.9, 3)[0];
  assert.ok(s > 0.99 && s <= 1);
});

test("similarEdges keeps each node's top-k but unions both ends", () => {
  // angles 0°, 2.9°, 11.3°, 16.7°: with k=1, 0↔1 and 2↔3 pick each other
  const v = [[1, 0], [1, 0.05], [1, 0.2], [1, 0.3]];
  assert.deepEqual(similarEdges(v, 0.5, 1).map(([a, b]) => [a, b]), [[0, 1], [2, 3]]);
  // k=2: node 1 also keeps 2 (8.4°) and node 2 keeps 1 — union, no duplicates
  assert.deepEqual(similarEdges(v, 0.5, 2).map(([a, b]) => [a, b]), [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]]);
});

test("similarEdges skips missing, zero and ragged vectors and tiny inputs", () => {
  assert.deepEqual(similarEdges([[1, 0]]), []);
  assert.deepEqual(similarEdges([undefined, [1, 0], [0, 0], [1, 0, 0], [1, 0.01]], 0.9).map(([a, b]) => [a, b]), [[1, 4]]);
  assert.deepEqual(similarEdges([[1, 0], [1, 0]], 0.5, 0), []);
});

test("edgeGlow: invisible before birth, brightest when new, fades to a floor", () => {
  const born = Date.UTC(2026, 0, 1);
  assert.equal(edgeGlow(born, born - 1), 0);
  assert.equal(edgeGlow(born, born), 1);
  const month = edgeGlow(born, born + 30 * DAY), year = edgeGlow(born, born + 365 * DAY);
  assert.ok(Math.abs(month - 0.6) < 1e-9); // 0.2 + 0.8 * 0.5
  assert.ok(year < month && year > 0.2);
  assert.ok(edgeGlow(born, born, 0.5) < edgeGlow(born, born, 1));
  assert.equal(edgeGlow(Number.NaN, born), 0);
  assert.equal(edgeBorn(5, 9), 9);
});

test("similarEdges matches a brute-force top-k on a larger set (unrolled path)", () => {
  let seed = 99;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 - 0.5; };
  const v = Array.from({ length: 13 }, (_, i) => Array.from({ length: 8 }, (_, d) => rand() + (d === i % 3 ? 1 : 0)));
  const cos = (a: number[], b: number[]) => a.reduce((s, x, d) => s + x * b[d], 0) / Math.hypot(...a) / Math.hypot(...b);
  const want = new Set<string>();
  v.forEach((a, i) => v.map((b, j) => [cos(a, b), j]).filter(([s, j]) => j !== i && s >= 0.3).sort((p, q) => q[0] - p[0]).slice(0, 2)
    .forEach(([, j]) => want.add(`${Math.min(i, j)}-${Math.max(i, j)}`)));
  const got = similarEdges(v, 0.3, 2);
  assert.deepEqual(new Set(got.map(([a, b]) => `${a}-${b}`)), want);
  for (const [a, b, s] of got) assert.ok(Math.abs(s - cos(v[a], v[b])) < 1e-3);
});
