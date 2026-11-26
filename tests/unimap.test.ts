import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYER, borderK, glide, layersAt, markerDeg } from "../src/lib/earth-layers-pure.ts";
import { borderLines, newsWeight } from "../src/lib/earth-borders-pure.ts";
import { earthData, earthWeather } from "../src/lib/earth-data-pure.ts";
import { levelAt } from "../src/lib/earth-pure.ts";
import type { Hotspot } from "../src/lib/geo.ts";

test("zoom levels: orbit = hotspots, country = borders + towns, close = neither", () => {
  const orbit = layersAt(10500), country = layersAt(900), close = layersAt(1.2);
  assert.ok(orbit.hotspots > 0.95 && orbit.towns < 0.01);
  assert.ok(country.hotspots < 0.02 && country.borders > 0.95 && country.towns > 0.95);
  assert.ok(close.hotspots === 0 && close.borders < 0.02 && close.towns < 0.02);
});
test("borders: calm from orbit, full at country zoom, never brighter than 1, fade in steps", () => {
  assert.ok(borderK(12000) < 0.4 && borderK(12000) > 0.05);
  assert.ok(borderK(3000) > 0.95);
  for (let a = 1; a < 20000; a *= 1.3) assert.ok(borderK(a) >= 0 && borderK(a) <= 1);
  assert.ok(borderK(5000) < borderK(3000) && borderK(8000) < borderK(5000));
});
test("every shot level has a layer: the camera shots land in the bands the layers expect", () => {
  assert.equal(levelAt(10500), "orbit");
  assert.ok(LAYER.hotspots.lo === 2500 && LAYER.towns.hi === LAYER.hotspots.lo, "towns take over where hotspots end");
});
test("glide: weather moves toward on/off, never past", () => {
  assert.equal(glide(0, true, 0.1) > 0, true);
  assert.equal(glide(0.95, true, 1), 1);
  assert.equal(glide(0.05, false, 1), 0);
  assert.equal(glide(0.5, false, 0), 0.5);
});

const ring = (pts: [number, number][]) => pts;
test("borderLines: news countries glow, quiet ones stay faint, Antarctica and the 180° cut are skipped", () => {
  const shapes = [
    { name: "Estonia", id: "233", rings: [ring([[22, 58], [28, 58], [28, 59.5], [22, 58]])] },
    { name: "Quietland", id: "1", rings: [ring([[0, 0], [1, 0], [1, 1], [0, 0]])] },
    { name: "Antarctica", id: "10", rings: [ring([[0, -80], [10, -80], [10, -85]])] },
    { name: "Russia", id: "643", rings: [ring([[179.95, 60], [179.95, 65], [-179.95, 65]])] },
  ];
  const b = borderLines(shapes, { Estonia: 12 }, 0);
  assert.equal(b.lonlat.length, b.segments * 4);
  assert.equal(b.weight.length, b.segments);
  const w = [...b.weight];
  assert.ok(w.includes(Math.fround(newsWeight(12, 12))) && w.includes(Math.fround(newsWeight(0, 12))));
  assert.equal(b.segments, 3 + 3 + 0, "Estonia 3, Quietland 3; Antarctica and the antimeridian ring add none");
  assert.ok(newsWeight(12, 12) > newsWeight(3, 12) && newsWeight(3, 12) > newsWeight(0, 12));
});
test("borderLines: close points are merged, the ring's last point is kept", () => {
  const dense: [number, number][] = Array.from({ length: 101 }, (_, i) => [i * 0.001, 0]);
  const b = borderLines([{ name: "X", id: "x", rings: [dense] }], {}, 0.04);
  assert.ok(b.segments < 10 && b.segments >= 2);
  assert.equal(b.lonlat[b.lonlat.length - 2], Math.fround(dense[100][0]));
});

const h = (name: string, lon: number, lat: number, n: number, urls: string[]): Hotspot => ({ name, lon, lat, count: n, stories: urls.map((u) => ({ title: `${name} ${u}`, url: u, source: `s-${name}-${u}`, published_at: null })) } as unknown as Hotspot);
test("earthWeather: isobars, H/L centres with numbers and typed fronts from the same hotspots", () => {
  const hs = [h("Ukraine", 31, 49, 30, ["a", "b", "c", "d", "e", "f"]), h("Poland", 19, 52, 9, ["a", "b", "c", "d", "e", "f"]), h("Chile", -71, -33, 1, ["z"])];
  const w = earthWeather(hs);
  assert.ok(w.isobars.length > 0 && w.isobars.every((i) => Number.isFinite(i.hpa) && i.lines.length > 0));
  assert.ok(w.centres.every((c) => (c.kind === "H" || c.kind === "L") && Number.isFinite(c.hpa)));
  assert.ok(w.centres.some((c) => c.kind === "H"), "a region with no news is a high");
  for (const f of w.fronts) assert.ok(["cold", "warm", "occluded"].includes(f.type));
  const d = earthData(hs, []);
  assert.deepEqual(d.hot, { Ukraine: 30, Poland: 9, Chile: 1 });
  assert.equal(d.weather.isobars.length, w.isobars.length);
});
test("earthWeather: no news, no crash", () => {
  const w = earthWeather([]);
  assert.deepEqual(w.isobars, []);
  assert.deepEqual(w.fronts, []);
});

test("markerDeg: small, grows with outlets, capped (a big story is not a huge ring)", () => {
  assert.ok(markerDeg(1) < markerDeg(9) && markerDeg(9) < markerDeg(30));
  assert.equal(markerDeg(30), markerDeg(400));
  assert.ok(markerDeg(30) < 4 && markerDeg(0) < 1.5);
});
