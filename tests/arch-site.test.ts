import { test } from "node:test";
import assert from "node:assert/strict";
import { starterScene } from "../src/lib/arch-pure.ts";
import { area, blockPrism, buildable, defaultSite, edgeSetbacks, inset, inside, PRESETS, readSite, rect, shadedShare, siteStats, toModel, unionArea, type Pt } from "../src/lib/arch-site-pure.ts";

const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);
const L: Pt[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]; // L-shape: 10×4 + 4×6 = 64 m²

test("area: rectangle, triangle, L-shape, either winding", () => {
  near(area(rect(0, 0, 30, 25)), 750);
  near(area([[0, 0], [6, 0], [0, 4]]), 12);
  near(area(L), 64);
  near(area([...L].reverse()), 64);
});

test("inside: the L's notch is outside", () => {
  assert.ok(inside([2, 8], L));
  assert.ok(inside([8, 2], L));
  assert.ok(!inside([8, 8], L));
  assert.ok(!inside([-1, 5], L));
});

test("setbacks: street edge, rear opposite, sides between; inset of a rectangle by hand", () => {
  const plot = rect(0, 0, 30, 25); // x −15..15, z −12.5..12.5; street on +Z
  const d = edgeSetbacks(plot, "s", { street: 3, side: 4, rear: 5 });
  assert.deepEqual(d, [5, 4, 3, 4]); // edges: −Z (rear), +X, +Z (street), −X
  const z = inset(plot, d)!;
  assert.deepEqual(z.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]).sort(), [[-11, -7.5], [-11, 9.5], [11, -7.5], [11, 9.5]].sort());
  near(area(z), 22 * 17);
  assert.deepEqual(edgeSetbacks(plot, "e", { street: 1, side: 2, rear: 3 }), [2, 1, 2, 3]);
});

test("setbacks: the L-shape insets by 1 m to the 8×2 + 2×6 L (28 m²); too deep is null", () => {
  near(area(inset(L, [1, 1, 1, 1, 1, 1])!), 28);
  assert.equal(inset(rect(0, 0, 10, 10), [6, 6, 6, 6]), null);
  assert.ok(buildable([5, 5], rect(5, 5, 10, 10), [2, 2, 2, 2]));
  assert.ok(!buildable([1, 5], rect(5, 5, 10, 10), [2, 2, 2, 2]));
  assert.ok(buildable([5, 10], rect(5, 5, 10, 10), [0, 0, 0, 0])); // on the boundary with a 0 m setback
});

test("union area counts overlaps once", () => {
  near(unionArea([{ x0: 0, x1: 10, z0: 0, z1: 8 }, { x0: 0, x1: 10, z0: 0, z1: 8 }]), 80);
  near(unionArea([{ x0: 0, x1: 4, z0: 0, z1: 4 }, { x0: 2, x1: 6, z0: 2, z1: 6 }]), 28);
});

test("coverage and FAR: starter house on the 30×25 plot", () => {
  const s = siteStats(starterScene().parts, defaultSite());
  near(s.plotArea, 750); near(s.footprint, 80); near(s.floorArea, 80);
  near(s.coverage, (80 / 750) * 100); near(s.far, 80 / 750);
  assert.ok(s.fits);
  const two = [...starterScene().parts, { id: "w2", kind: "wall" as const, name: "Walls, floor 2", x: 0, y: 3, z: 0, w: 10, d: 8, h: 2.8 }];
  near(siteStats(two, defaultSite()).far, 160 / 750);
  // a 12 m wide plot with 4 m sides leaves a 4 m strip: the 10 m house doesn't fit
  const tight = siteStats(starterScene().parts, { ...defaultSite(), plot: rect(0, 0, 12, 40) });
  assert.ok(!tight.fits);
  assert.deepEqual(tight.outside, ["Ground floor slab", "Walls, floor 1"]);
  for (const p of PRESETS) assert.ok(siteStats(starterScene().parts, { ...defaultSite(), ...p.site }).fits, p.key);
});

test("north: turning the plot turns the sun", () => {
  const fromNorth = { x: 0, y: 0, z: -1 }; // sun due north at the horizon (+x east, −z north)
  const r0 = toModel(fromNorth, 0), r90 = toModel(fromNorth, 90);
  near(r0.x, 0); near(r0.z, -1);
  near(r90.x, 1); near(r90.z, 0, 1e-12);
  const east = toModel({ x: 1, y: 0, z: 0 }, 90); // east is then +Z
  near(east.x, 0, 1e-12); near(east.z, 1);
});

test("shadow: a block east of a house shades its east wall when the sun is low enough", () => {
  const house = rect(-4, 0, 2, 2); // east face at x = −3, two samples
  const sun = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }; // from +X, 45° high
  const tall = blockPrism({ id: "a", name: "Tall", x: 0, z: 0, w: 2, d: 2, h: 10 });
  near(shadedShare(house, 1.5, [tall], sun)!, 1); // reaches the block (x = −1) at 1.5 + 1.95 = 3.45 m < 10 m
  near(shadedShare(house, 1.5, [{ ...tall, top: 3 }], sun)!, 0); // 3.45 m > 3 m: clears it
  near(shadedShare(house, 1.5, [{ ...tall, poly: rect(0, 5, 2, 2) }], sun)!, 0); // off to the side
  assert.equal(shadedShare(house, 1.5, [tall], { x: 1, y: -0.1, z: 0 }), null); // night
});

test("readSite: bad stored data falls back to defaults", () => {
  assert.deepEqual(readSite(null), defaultSite());
  const s = readSite({ on: true, plot: [[0, 0], [1, "x"]], north: 1e9, street: "up", setback: { street: -2 }, neighbours: [{ name: "A", h: "tall" }, 5] });
  assert.equal(s.on, true); assert.equal(s.plot.length, 4); assert.equal(s.north, 360); assert.equal(s.street, "s"); assert.equal(s.setback.street, 0);
  assert.equal(s.neighbours.length, 1); assert.equal(s.neighbours[0].h, 8);
});
