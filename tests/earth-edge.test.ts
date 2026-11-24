import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeAlpha, coverCircle, FEATHER } from "../src/lib/earth-ground-pure.ts";

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
