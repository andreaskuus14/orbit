import { test } from "node:test";
import assert from "node:assert/strict";
import { DIM, dimLines } from "../src/lib/arch-dims-pure.ts";
import { fovOf, homeShot, partsBox } from "../src/lib/arch-camera-pure.ts";

const fp = { x0: -4, x1: 6, z0: -5, z1: 7 };

test("dimension lines sit outside the footprint, run the full width, depth and height, and have ticks at both ends", () => {
  const d = dimLines(fp, 8.6);
  const [w, dep, h] = d.main;
  assert.ok(Math.abs(Math.abs(w.b[0] - w.a[0]) - 10) < 1e-9 && w.a[2] > fp.z1 + 1);
  assert.ok(Math.abs(Math.abs(dep.b[2] - dep.a[2]) - 12) < 1e-9 && dep.a[0] > fp.x1 + 1);
  assert.equal(h.a[1], 0); assert.equal(h.b[1], 8.6);
  assert.ok(h.a[0] > fp.x1 && h.a[2] === fp.z0, "the height line stands beside the house, level with its far corner");
  assert.equal(d.ticks.length, 6); assert.equal(d.ext.length, 6);
  for (const s of d.ext) assert.ok(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) > 0.3);
  assert.equal(d.outline.length, 5);
});

test("labels sit on their own lines (centre of the line), the area label just beyond the width line", () => {
  const d = dimLines(fp, 8.6);
  assert.deepEqual(d.at.w, [1, DIM.y, 7 + DIM.off]); assert.deepEqual(d.at.d, [6 + DIM.off, DIM.y, 1]);
  assert.equal(d.at.h[1], 4.3);
  assert.ok(d.at.a[2] > d.at.w[2] && d.at.a[0] === d.at.w[0]);
});

test("the lens: 40 mm on a 24 mm frame is 33.4 degrees", () => { assert.ok(Math.abs(fovOf() - 33.4) < 0.05); });

test("opening shot: three-quarter view from the south-east, the whole house in front of the camera, further back on narrow screens", () => {
  const box = partsBox([{ kind: "wall", x: 0, y: 0, z: 0, w: 10, d: 8, h: 6 }, { kind: "roof", x: 0, y: 6, z: 0, w: 11, d: 9, h: 2.5 }, { kind: "prop", x: 40, y: 0, z: 40, w: 1, d: 1, h: 1 }])!;
  assert.deepEqual(box.min, [-5.5, 0, -4.5]); assert.deepEqual(box.max, [5.5, 8.5, 4.5]);
  const wide = homeShot(box, 1.9, 0.3), narrow = homeShot(box, 0.6, 0);
  assert.ok(wide.position[0] > 0 && wide.position[2] > 0, "south-east");
  assert.ok(wide.position[1] > wide.target[1] && wide.position[1] < wide.target[1] + wide.distance * 0.35, "a little above eye level");
  assert.ok(Math.abs(Math.hypot(...wide.position.map((v, i) => v - wide.target[i]) as [number, number, number]) - wide.distance) < 1e-9);
  const R = Math.hypot(11, 8.5, 9) / 2;
  assert.ok(wide.distance > R * 0.95, "the bounding sphere (nearly) fits");
  assert.ok(narrow.distance > wide.distance, "a tall narrow screen backs off");
  assert.ok(Math.abs(wide.fov - fovOf()) < 1e-9);
  assert.equal(partsBox([]), null);
});
