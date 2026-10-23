import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, starterScene } from "../src/lib/arch-pure.ts";
import { buildFront, collides, lidarDots, moveWalker, NO_FRONT, wallRects, walkStart, WALK } from "../src/lib/arch-walk-pure.ts";

const plot = { w: 30, d: 25 };

test("shell wall blocks the walker; he slides along it", () => {
  const rects = wallRects(starterScene().parts); // 10 × 8 shell at the origin
  assert.equal(rects.length, 4);
  const p = moveWalker(0, 8, 0, -10, rects, plot); // walk north into the south wall (z = 4)
  assert.ok(p.z > 4 + WALK.radius - 1e-9 && p.z < 4.5);
  const s = moveWalker(0, 6, 3, -3, rects, plot); // diagonal: z blocked, x still moves
  assert.ok(s.x > 2.9);
  assert.ok(!collides(s.x, s.z, rects));
});

test("a door is a gap you can walk through", () => {
  let n = 0;
  const sc = applyOps(starterScene(), [{ op: "add", kind: "door", host: "p3", face: "s", w: 1 }], () => `d${++n}`).scene;
  const rects = wallRects(sc.parts);
  assert.equal(rects.length, 5); // south strip split in two
  const p = moveWalker(0, 6, 0, -6, rects, plot);
  assert.ok(p.z < 0.1, `got through the door: z=${p.z}`);
  assert.ok(moveWalker(3, 6, 0, -6, rects, plot).z > 4); // beside the door it still blocks
});

test("plot edge, upper floors and bad input", () => {
  assert.deepEqual(moveWalker(0, 0, 999, 0, [], plot), { x: 15 - WALK.radius, z: 0 });
  assert.deepEqual(moveWalker(1, 2, NaN, 0, [], plot), { x: 1, z: 2 });
  let n = 0;
  const two = applyOps(starterScene(), [{ op: "add", kind: "wall", w: 10, d: 8, h: 2.8, y: 3.2 }], () => `w${++n}`).scene;
  assert.equal(wallRects(two.parts).length, 4); // the upper floor's walls are over his head
  const st = walkStart(plot, wallRects(two.parts));
  assert.ok(!collides(st.x, st.z, wallRects(two.parts)) && st.yaw === 0);
});

test("build front climbs bottom to top, then disappears; dots stay bounded", () => {
  const solid = starterScene().parts;
  assert.equal(buildFront(solid, 0, 0), -0.8);
  const mid = buildFront(solid, 0.6 + 2.5 * 0.45, 0);
  assert.ok(mid > 0.2 && mid < 3);
  assert.equal(buildFront(solid, 100, 0), NO_FRONT);
  assert.equal(buildFront([], 0, 0), NO_FRONT);
  const d = lidarDots(5);
  assert.ok(d.length % 3 === 0 && d.length / 3 > 60 && d.every(Number.isFinite));
  assert.ok(lidarDots(1e6).length / 3 < 25000);
});
