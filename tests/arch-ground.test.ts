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

import { farMesh, meadowHeight, meadowRadius, treePlan, undergrowth } from "../src/lib/arch-ground-pure.ts";

test("meadow: big enough for any plot, flat round the house, soft swells, no step at the rim", () => {
  assert.equal(meadowRadius({ w: 20, d: 20 }), 60); assert.ok(meadowRadius({ w: 60, d: 40 }) >= 132);
  const r = meadowRadius({ w: 30, d: 25 });
  for (let a = 0; a < 6.3; a += 0.3) { assert.ok(Math.abs(meadowHeight(0.2, a, r)) === 0); assert.ok(Math.abs(meadowHeight(0.34, a, r)) < 1e-9); assert.ok(Math.abs(meadowHeight(1, a, r)) < 1e-9, "joins the far plane"); }
  let hi = 0; for (let a = 0; a < 6.3; a += 0.1) for (let rho = 0; rho <= 1; rho += 0.05) hi = Math.max(hi, Math.abs(meadowHeight(rho, a, r)));
  assert.ok(hi > 0.3 && hi <= 1.4, `${hi}`);
  assert.equal(groundY(0, 0, r, meadowHeight), 0);
});

test("tree plan: framing trees stand back and never in the camera's sector; far trees ring the edge; deterministic", () => {
  const r = 66, fp = { x0: -4, x1: 4, z0: -5, z1: 5 }, camAz = Math.PI / 4, plan = treePlan(r, fp, camAz);
  assert.deepEqual(plan, treePlan(r, fp, camAz));
  assert.ok(plan.mid.length >= 11 && plan.mid.length <= 14, `${plan.mid.length}`); assert.equal(plan.far.length, 0); assert.equal(treePlan(r, fp, camAz, 14, 40).far.length, 40);
  for (const t of plan.mid) {
    const d = Math.hypot(t.x, t.z);
    assert.ok(d >= Math.hypot(8, 10) / 2 + 20 - 1e-6, `clear of the house: ${d}`);
    assert.ok(d <= r * 0.7 + 1e-6, "inside the meadow");
    const diff = Math.abs(Math.atan2(Math.sin(t.a - camAz), Math.cos(t.a - camAz)));
    assert.ok(diff >= 0.95 || d >= 0.62 * r, "not in front of the camera");
  }
  for (const t of treePlan(r, fp, camAz, 14, 40).far) { const d = Math.hypot(t.x, t.z); assert.ok(d >= r * 0.79 && d <= r * 0.98); }
  for (let i = 0; i < plan.mid.length; i++) for (let j = i + 1; j < plan.mid.length; j++) assert.ok(Math.hypot(plan.mid[i].x - plan.mid[j].x, plan.mid[i].z - plan.mid[j].z) >= 7 - 1e-6);
  assert.ok(treePlan(r, null).mid.length > 0, "works without a footprint");
});

test("undergrowth hugs the trees", () => {
  const trees = treePlan(66, null).mid, u = undergrowth(trees, 3);
  assert.equal(u.length, trees.length * 3);
  for (const p of u) assert.ok(trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 4.5));
});

test("far ground: starts on the lawn's rim ring, flat, indices in range, colours continue the lawn's", () => {
  const r = 66, segs = 48, lawn = groundMesh(r, segs, meadowHeight), far = farMesh(r, segs);
  lawn.rim.forEach((vi, s) => { for (let k = 0; k < 3; k++) assert.ok(Math.abs(lawn.pos[vi * 3 + k] - far.pos[s * 3 + k]) < 1e-9, `seam ${s}`); for (let k = 0; k < 3; k++) assert.ok(Math.abs(lawn.col[vi * 3 + k] - far.col[s * 3 + k]) < 1e-9, "same colour at the seam"); });
  for (const i of far.idx) assert.ok(i < far.pos.length / 3);
  for (let i = 1; i < far.pos.length; i += 3) assert.equal(far.pos[i], 0);
  assert.ok(Math.hypot(far.pos[far.pos.length - 3], far.pos[far.pos.length - 1]) > r * 10);
});

import { silhouettes } from "../src/lib/arch-ground-pure.ts";
test("forest-edge silhouettes: n of them across the tile, mixed conifers and round crowns, deterministic", () => {
  const s = silhouettes(44, 1);
  assert.equal(s.length, 44); assert.deepEqual(s, silhouettes(44, 1)); assert.notDeepEqual(s, silhouettes(44, 2));
  for (const t of s) { assert.ok(t.x >= 0 && t.x < 1.02); assert.ok(t.h >= 0.35 && t.h <= 0.95 && t.w > 0); }
  const c = s.filter((t) => t.conifer).length; assert.ok(c > 16 && c < 38, `${c}`);
});
