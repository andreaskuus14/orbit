import { test } from "node:test";
import assert from "node:assert/strict";
import { archFootprint, devIsland, lifeGarden, memoryCity, metres, scatter } from "../src/lib/worlds-v3-pure.ts";

test("scatter is deterministic and keeps out of avoid circles", () => {
  const a = scatter(40, 1, 6, 3, [[0, 0, 2]]), b = scatter(40, 1, 6, 3, [[0, 0, 2]]);
  assert.deepEqual(a, b);
  for (const p of a) assert.ok(Math.hypot(p.x, p.z) >= 2 && Math.hypot(p.x, p.z) <= 6.01);
});

test("GAME DEV: focus = furthest stage, built share follows stage, drones = running tasks, junk is safe", () => {
  const world = { games: [{ id: "a", name: "A", stage: "prototype" }, { id: "b", name: "B", stage: "beta" }, { id: "c", name: "C", stage: "idea" }],
    bugs: [{ game: "b", severity: "crash", status: "open" }, { game: "b", severity: "minor", status: "fixed" }, { game: "a", severity: "major", status: "fixing" }] };
  const s = devIsland(world, { running: 9 });
  assert.equal(s.focus?.id, "b"); assert.equal(s.focus?.open, 1); assert.equal(s.focus?.crash, 1);
  assert.equal(s.parts.filter((p) => p.built).length, 8); assert.ok(s.portalLit); assert.equal(s.drones, 6); assert.equal(s.others.length, 2);
  const picked = devIsland(world, { selected: "c" });
  assert.equal(picked.focus?.id, "c"); assert.equal(picked.parts.filter((p) => p.built).length, 1); assert.ok(!picked.portalLit); assert.equal(picked.drones, 0);
  for (const junk of [null, {}, { games: "x", bugs: 3 }]) assert.equal(devIsland(junk as never).focus, null);
});

test("ARCH: footprint of the ground floor, metres formatting", () => {
  const f = archFootprint([{ kind: "slab", x: 0, y: 0, z: 0, w: 10, d: 8, h: 0.3 }, { kind: "wall", x: 0, y: 3, z: 0, w: 20, d: 0.3, h: 3 }, { kind: "roof", x: 0, y: 3, z: 0, w: 30, d: 30, h: 2 }]);
  assert.deepEqual(f && [f.w, f.d], [10, 8]);
  assert.equal(archFootprint([]), null);
  assert.equal(metres(7.654), "7.65 m"); assert.equal(metres(14.4), "14.4 m");
});

test("MEMORY: spire at the weighted centre, each district threaded to it, no duplicate threads", () => {
  const c = memoryCity([{ kind: "a", count: 30, x: 10, z: 0 }, { kind: "b", count: 10, x: -10, z: 0 }, { kind: "c", count: 10, x: 0, z: 10 }], -5);
  assert.equal(c.spire.x, 4); assert.equal(c.total, 50);
  assert.ok(c.threads.length >= 3 && c.threads.length <= 6);
  assert.equal(new Set(c.threads.map((t) => JSON.stringify(t))).size, c.threads.length);
  assert.deepEqual(memoryCity([], 0).threads, []);
});

test("LIFE: plants stay off the pond and the pods", () => {
  const pods = [{ at: [4.2, 0, 0] as [number, number, number] }, { at: [-4.2, 0, 0] as [number, number, number] }];
  const g = lifeGarden(pods);
  for (const p of [...g.bushes, ...g.flowers]) { assert.ok(Math.hypot(p.x, p.z) >= 2.5); for (const d of pods) assert.ok(Math.hypot(p.x - d.at[0], p.z - d.at[2]) >= 1.25); }
  assert.ok(g.pads.every((p) => Math.hypot(p.x, p.z) < 2));
});
