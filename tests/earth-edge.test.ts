import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeAlpha, coverCircle, buildingEdge, FEATHER } from "../src/lib/earth-ground-pure.ts";
import { BZ } from "../src/lib/earth-buildings-pure.ts";
import { x2lon, y2lat } from "../src/lib/earth-pure.ts";

const set = (ks: string[]) => { const s = new Set(ks); return (x: number, y: number) => s.has(`${x}/${y}`); };

test("edgeAlpha: lone tile is 0 on every border, 1 in the middle", () => {
  const has = set(["0/0"]);
  for (const [u, v] of [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1], [0, 0], [1, 1]]) assert.equal(edgeAlpha(0, 0, u, v, has), 0);
  assert.equal(edgeAlpha(0, 0, 0.5, 0.5, has), 1);
  const mid = edgeAlpha(0, 0, FEATHER / 2, 0.5, has); assert.ok(mid > 0.4 && mid < 0.6);
});
test("edgeAlpha: shared borders stay solid, so neighbours meet without a seam", () => {
  const has = set(["0/0", "1/0", "0/1", "1/1", "-1/0", "-1/1", "0/-1", "1/-1", "-1/-1"]);
  assert.equal(edgeAlpha(0, 0, 0, 0, has), 1); // fully surrounded
  const h2 = set(["0/0", "1/0"]);
  assert.equal(edgeAlpha(0, 0, 1, 0.5, h2), edgeAlpha(1, 0, 0, 0.5, h2)); // same value on both sides of the shared edge
  assert.equal(edgeAlpha(0, 0, 1, 0.5, h2), 1);
});
test("edgeAlpha: a missing diagonal tile fades only its corner", () => {
  const all = ["-1/-1", "0/-1", "1/-1", "-1/0", "0/0", "1/0", "-1/1", "0/1"]; // 1/1 missing
  const has = set(all);
  assert.equal(edgeAlpha(0, 0, 1, 1, has), 0);
  assert.equal(edgeAlpha(0, 0, 0.5, 1, has), 1);
  assert.equal(edgeAlpha(0, 0, 1, 0.5, has), 1);
});
test("edgeAlpha: monotonic toward the inside", () => {
  const has = set(["0/0"]); let p = -1;
  for (let u = 0; u <= 0.5; u += 0.05) { const a = edgeAlpha(0, 0, u, 0.5, has); assert.ok(a >= p); p = a; }
});
test("coverCircle", () => {
  assert.equal(coverCircle([]), null);
  assert.deepEqual(coverCircle([{ x: 3, y: 4 }]), { x: 3.5, y: 4.5, r: Math.SQRT1_2 });
  const c = coverCircle([{ x: 0, y: 0 }, { x: 1, y: 0 }])!; assert.equal(c.x, 1); assert.equal(c.y, 0.5); assert.ok(Math.abs(c.r - Math.hypot(1, 0.5)) < 1e-12);
});

// a small square building centred at tile-local (u, v) of tile (x, y)
const sq = (x: number, y: number, u: number, v: number) => { const d = 1e-4, lo = x2lon(x + u, BZ), la = y2lat(y + v, BZ); return { r: [[lo - d, la - d], [lo + d, la - d], [lo + d, la + d], [lo - d, la + d]] as [number, number][] }; };
test("buildingEdge: one value per vertex (5 per ring point), whole building alike", () => {
  const has = set(["0/0"]);
  const a = buildingEdge(0, 0, [sq(0, 0, 0.5, 0.5), sq(0, 0, 0.05, 0.5)], has);
  assert.equal(a.length, 40);
  assert.ok(a.slice(0, 20).every((v) => Math.abs(v - 1) < 1e-6)); // middle: full height
  assert.ok(a.slice(20).every((v) => v === a[20]) && a[20] < 0.1); // near the open edge: almost gone
});
test("buildingEdge: matches the ground's mask; interior and ground-less tiles stay solid", () => {
  const has = set(["0/0", "1/0"]);
  const a = buildingEdge(0, 0, [sq(0, 0, 0.9, 0.5)], has);
  assert.ok(Math.abs(a[0] - edgeAlpha(0, 0, 0.9, 0.5, has)) < 0.02);
  assert.ok(buildingEdge(5, 5, [sq(5, 5, 0.01, 0.01)], has).every((v) => v === 1));
});
