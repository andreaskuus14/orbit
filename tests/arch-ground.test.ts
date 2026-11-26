import { test } from "node:test";
import assert from "node:assert/strict";
import { RINGS, groundHeight, groundMesh, groundY, meadowSpots, rimDrop, rimRadius, rimSpots, rockMesh } from "../src/lib/arch-ground-pure.ts";

const R = 21.6;

test("the rim is irregular but stays within 10 % of the nominal radius", () => {
  let lo = 9, hi = 0;
  for (let i = 0; i < 360; i++) { const k = rimRadius((i / 360) * Math.PI * 2, 1); lo = Math.min(lo, k); hi = Math.max(hi, k); }
  assert.ok(lo > 0.9 && hi < 1.1, `${lo} ${hi}`); assert.ok(hi - lo > 0.05, "not a circle");
});

test("ground is flat under the house, then rolls down at the rim by rimDrop", () => {
  for (let a = 0; a < 6.3; a += 0.4) { assert.equal(groundHeight(0, a, R), 0); assert.ok(Math.abs(groundHeight(0.45, a, R)) < 1e-9); }
  const edge = groundHeight(1, 2, R); assert.ok(edge < -rimDrop(R) * 0.8, `${edge}`);
  for (let a = 0; a < 6.3; a += 0.3) for (let rho = 0; rho <= 0.9; rho += 0.05) assert.ok(Math.abs(groundHeight(rho, a, R)) <= 0.23, "mounds stay small");
  assert.ok(groundHeight(0.98, 1, R) > groundHeight(1, 1, R), "falls towards the edge");
});

test("groundY matches the mesh height at a world position", () => {
  const a = 0.9, rho = 0.7, rad = rimRadius(a, R) * rho;
  assert.ok(Math.abs(groundY(Math.cos(a) * rad, Math.sin(a) * rad, R) - groundHeight(rho, a, R)) < 1e-9);
  assert.equal(groundY(0, 0, R), 0);
});

test("ground mesh: sizes, indices in range, normals up, shares the rim ring with the rock", () => {
  const segs = 48, g = groundMesh(R, segs), n = g.pos.length / 3;
  assert.equal(n, 1 + (RINGS.length - 1) * segs); assert.equal(g.col.length, g.pos.length); assert.equal(g.idx.length % 3, 0);
  for (const i of g.idx) assert.ok(i < n);
  let down = 0;
  for (let t = 0; t < g.idx.length; t += 3) { // flat-ish triangles must face +y
    const [a, b, c] = [g.idx[t], g.idx[t + 1], g.idx[t + 2]].map((i) => [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); // y of (b-a)x(c-a)... sign checked by the count below
    if (ny < 0) down++;
  }
  assert.equal(down, 0, "no triangle faces down");
  const rock = rockMesh(R, segs);
  g.rim.forEach((vi, s) => { assert.ok(Math.abs(g.pos[vi * 3] - rock.pos[s * 3]) < 1e-5 && Math.abs(g.pos[vi * 3 + 1] - rock.pos[s * 3 + 1]) < 1e-5 && Math.abs(g.pos[vi * 3 + 2] - rock.pos[s * 3 + 2]) < 1e-5, `seam at ${s}`); });
  for (const c of g.col) assert.ok(c > 0.2 && c < 1.6);
});

test("rock mesh: indices in range, narrows going down, deterministic", () => {
  const r = rockMesh(R, 48, 6), r2 = rockMesh(R, 48, 6);
  assert.deepEqual(Array.from(r.pos), Array.from(r2.pos));
  for (const i of r.idx) assert.ok(i < r.pos.length / 3);
  const top = Math.hypot(r.pos[0], r.pos[2]), bottom = Math.hypot(r.pos[6 * 48 * 3], r.pos[6 * 48 * 3 + 2]);
  assert.ok(bottom < top * 0.75, `${bottom} ${top}`); assert.ok(r.pos[6 * 48 * 3 + 1] < -R * 0.7 + 0.3);
});

test("rim and meadow spots: inside the rim, deterministic, clear of the house", () => {
  const spots = rimSpots(R, 20, [0.8, 0.93]);
  assert.equal(spots.length, 20); assert.deepEqual(spots, rimSpots(R, 20, [0.8, 0.93]));
  for (const s of spots) { const rho = Math.hypot(s.x, s.z) / rimRadius(s.a, R); assert.ok(rho >= 0.79 && rho <= 0.94, `${rho}`); }
  const fp = { x0: -5, x1: 5, z0: -4, z1: 4 }, m = meadowSpots(R, 40, fp, 2);
  assert.ok(m.length > 30);
  for (const s of m) assert.ok(!(s.x > -7 && s.x < 7 && s.z > -6 && s.z < 6));
});
