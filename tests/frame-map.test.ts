import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAMES, FRAME_IDS, nextFrame, tabFrame, dolly, fit, onPlate, PLATE, pinsFor, platePoint, plateOpacity } from "../src/lib/frame-map-pure.ts";

test("platePoint is exact at every control point", () => {
  for (const [lon, lat, x, y] of FRAMES.world.control) { const p = platePoint(lon, lat); assert.ok(Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01, `${lon},${lat}`); }
});
test("platePoint puts places where the plate has them (Tallinn above Cairo, Tokyo right of London)", () => {
  const t = platePoint(24.7, 59.4), c = platePoint(31, 30), l = platePoint(0, 51.5), j = platePoint(140, 36);
  assert.ok(t.y < c.y && j.x > l.x + 300);
});
test("onPlate: the oval holds the middle and not the corners", () => {
  assert.ok(onPlate({ x: 672, y: 380 })); assert.ok(!onPlate({ x: 5, y: 5 })); assert.ok(!onPlate({ x: 1340, y: 745 }));
});
test("pinsFor: sized by count, cards never overlap, busiest first", () => {
  const hs = [["Germany", 10.4, 51.1, 30], ["France", 2.2, 46.2, 20], ["Ukraine", 31.1, 48.3, 40], ["Japan", 138, 36, 5], ["Brazil", -51.9, -14.2, 8], ["Egypt", 30.8, 26.8, 12]].map(([name, lon, lat, count]) => ({ name: name as string, lon: lon as number, lat: lat as number, count: count as number }));
  const pins = pinsFor(hs, { cards: 6, cardW: 150, cardH: 46 });
  assert.ok(pins.length >= 5);
  const big = pins.find((p) => p.name === "Ukraine")!, small = pins.find((p) => p.name === "Japan")!;
  assert.ok(big.r > small.r);
  const cards = pins.filter((p) => p.card);
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    assert.ok(a.cx + 150 <= b.cx || b.cx + 150 <= a.cx || a.cy + 46 <= b.cy || b.cy + 46 <= a.cy, `${a.name}/${b.name}`);
  }
});
test("fit centres the whole plate in the stage", () => {
  const f = fit(1000, 800, 10, 20);
  assert.ok(Math.abs(f.s - 1000 / PLATE.w) < 1e-9 && f.x === 10 && f.y > 20);
});
test("dolly eases 1 -> max and the plate fades out only late", () => {
  assert.equal(dolly(0), 1); assert.equal(dolly(1, 3), 3); assert.ok(dolly(0.5) > 1 && dolly(0.5) < 3.4);
  assert.equal(plateOpacity(0.3), 1); assert.equal(plateOpacity(1), 0); assert.ok(plateOpacity(0.8) < 1 && plateOpacity(0.8) > 0);
});

test("every plate with landmarks is exact at them and finite elsewhere in its box", () => {
  for (const id of FRAME_IDS) {
    const d = FRAMES[id]; if (!d.control.length) continue;
    for (const [lon, lat, x, y] of d.control) { const p = platePoint(lon, lat, id); assert.ok(Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01, `${id} ${lon},${lat}`); }
    const q = platePoint(d.control[0][0] + 0.2, d.control[0][1] + 0.1, id); assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
  }
});
test("Estonian towns land in their places on the Estonia plate (Tallinn north-west of Tartu, Kuressaare far west)", () => {
  const t = platePoint(24.7536, 59.437, "estonia"), r = platePoint(26.729, 58.378, "estonia"), k = platePoint(22.4853, 58.2481, "estonia"), v = platePoint(25.59, 58.364, "estonia");
  assert.ok(t.y < r.y && t.x < r.x && k.x < t.x && v.x > 500 && v.x < 980);
});
test("village cards go to the fixed slots; stories-less places get no pin", () => {
  const pins = pinsFor([{ name: "Kuremäe", lon: 27.5, lat: 59.3, count: 3 }, { name: "Quiet", lon: 25, lat: 58.5, count: 0 }], { frame: "village" });
  assert.equal(pins.length, 1); assert.deepEqual([pins[0].x, pins[0].y], [860, 250]);
});
test("nextFrame: world -> Europe or Estonia or the 3D Earth; Estonia -> Tallinn, a village, or 3D", () => {
  assert.equal(nextFrame("world", { name: "Germany", lon: 10, lat: 51 }), "europe");
  assert.equal(nextFrame("world", { name: "Estonia", lon: 25, lat: 58.7 }), "estonia");
  assert.equal(nextFrame("world", { name: "Brazil", lon: -51, lat: -14 }), null);
  assert.equal(nextFrame("europe", { name: "France", lon: 2, lat: 46 }), null);
  assert.equal(nextFrame("europe", { name: "Estonia", lon: 25, lat: 58.7 }), "estonia");
  assert.equal(nextFrame("estonia", { name: "Tallinn", lon: 24.75, lat: 59.43 }), "tallinn");
  assert.equal(nextFrame("estonia", { name: "Kuremäe", lon: 27.5, lat: 59.3, kind: "village" }), "village");
  assert.equal(nextFrame("estonia", { name: "Tartu", lon: 26.7, lat: 58.4, kind: "city" }), null);
  assert.equal(nextFrame("tallinn", { name: "Kalamaja", lon: 24.73, lat: 59.44 }), null);
});
test("tabFrame", () => { assert.equal(tabFrame("orbit"), "world"); assert.equal(tabFrame("country"), "estonia"); assert.equal(tabFrame("region"), "estonia"); assert.equal(tabFrame("town"), "tallinn"); });

import { easeOffset, pointerNorm, shiftFor, PARALLAX } from "../src/lib/frame-parallax-pure.ts";
test("parallax: near pixels move against the pointer, far ones with it, mid ones stay; close plates lean more", () => {
  const a = shiftFor(1, [1, 0], 0.02), b = shiftFor(0, [1, 0], 0.02), m = shiftFor(0.5, [1, 0], 0.02);
  assert.ok(a[0] < 0 && b[0] > 0 && m[0] === 0 && a[1] === 0);
  assert.ok(PARALLAX.village > PARALLAX.world);
});
test("pointerNorm clamps and easeOffset converges", () => {
  assert.deepEqual(pointerNorm(0, 100, 200, 200), [-1, 0]); assert.deepEqual(pointerNorm(999, -5, 200, 200), [1, -1]);
  let o: [number, number] = [0, 0]; for (let i = 0; i < 60; i++) o = easeOffset(o, [1, -1], 1 / 60);
  assert.ok(o[0] > 0.9 && o[1] < -0.9);
});

import { nearPainted } from "../src/lib/frame-map-pure.ts";
test("nearPainted: the painted Atlantic storm blocks a live swirl on top of it, open ocean does not", () => {
  assert.ok(nearPainted({ x: 405, y: 383 })); assert.ok(nearPainted({ x: 470, y: 400 })); assert.ok(!nearPainted({ x: 1000, y: 600 }));
});
