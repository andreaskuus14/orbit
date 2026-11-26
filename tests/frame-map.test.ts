import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROL, dolly, fit, onPlate, PLATE, pinsFor, platePoint, plateOpacity } from "../src/lib/frame-map-pure.ts";

test("platePoint is exact at every control point", () => {
  for (const [lon, lat, x, y] of CONTROL) { const p = platePoint(lon, lat); assert.ok(Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01, `${lon},${lat}`); }
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
