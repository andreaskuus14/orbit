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
  assert.ok(Math.abs(b.lonlat[b.lonlat.length - 2] - 0.1) <= 0.04, "ends at the ring's end, snapped to the grid");
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

test("borderLines: a border two countries share is drawn once, with the busier country's weight", () => {
  const shared: [number, number][] = [[10, 50], [10, 51], [10, 52]];
  const a = { name: "A", id: "1", rings: [[...shared, [9, 52] as [number, number]]] }, b = { name: "B", id: "2", rings: [[[11, 52] as [number, number], ...shared.slice().reverse()]] };
  const one = borderLines([a, b], { A: 1 }, 0.04), solo = borderLines([a], { A: 1 }, 0.04);
  assert.ok(one.segments < solo.segments + 3 + 2, "no doubled line");
  const sharedSegs = [...one.lonlat].map((_, i) => i).filter((i) => i % 4 === 0 && one.lonlat[i] === 10 && one.lonlat[i + 2] === 10);
  assert.equal(sharedSegs.length, 2, "the two shared segments exist once each");
  assert.ok(sharedSegs.every((i) => one.weight[i / 4] === Math.fround(newsWeight(1, 1))));
});
test("earthWeather: every news system gets a swirl, storms flagged", () => {
  const w = earthWeather([h("Ukraine", 31, 49, 30, ["a", "b", "c", "d", "e", "f"]), h("Chile", -71, -33, 1, ["z"])]);
  assert.ok(w.swirls.length >= 1 && w.swirls.every((s) => Number.isFinite(s.lon) && /^#/.test(s.color) && s.outlets >= 1));
});

import { miniMapTiles, nextSnap, parseSnap, rankRows, topStories, ago } from "../src/lib/intel-rank-pure.ts";
test("rankRows: busiest first, score against the busiest, trend against the earlier snapshot", () => {
  const hs = [h("Peru", -75, -10, 4, ["a"]), h("Ukraine", 31, 49, 20, ["b"]), h("Chile", -71, -33, 8, ["c"])];
  const r = rankRows(hs, { Ukraine: 14, Chile: 9 }, 2);
  assert.deepEqual(r.map((x) => x.name), ["Ukraine", "Chile"]);
  assert.deepEqual(r.map((x) => x.score), [99, 40]);
  assert.deepEqual(r.map((x) => x.delta), [6, -1]);
  assert.equal(rankRows(hs, null)[0].delta, 0);
});
test("snapshot: kept while young, replaced when old, bad JSON ignored", () => {
  const old = { at: 1000, counts: { A: 1 } };
  assert.equal(nextSnap(old, { A: 5 }, 2000), old);
  assert.deepEqual(nextSnap(old, { A: 5 }, 1000 + 7 * 3600_000).counts, { A: 5 });
  assert.equal(parseSnap("{nope"), null);
  assert.deepEqual(parseSnap(JSON.stringify(old)), old);
});
test("miniMapTiles: the place is in the middle of the box and tiles cover it", () => {
  const t = miniMapTiles(24.75, 59.44, 4, 300, 118);
  assert.ok(t.length >= 2 && t.every((x) => x.x >= 0 && x.x < 16 && x.y >= 0 && x.y < 16));
  assert.ok(t.some((x) => x.left <= 150 && x.left + 256 >= 150 && x.top <= 59 && x.top + 256 >= 59), "a tile holds the centre");
  assert.ok(miniMapTiles(179.9, 0, 3, 300, 118).every((x) => x.x >= 0 && x.x < 8), "wraps at the antimeridian");
});
test("ago + topStories: short ages, biggest system first", () => {
  assert.equal(ago("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:28:00Z")), "28 min ago");
  assert.equal(ago(null, 0), "");
  const hs = [h("Ukraine", 31, 49, 30, ["a", "b", "c", "d", "e", "f"]), h("Chile", -71, -33, 1, ["z"])];
  const s = topStories(hs, Date.now(), 2);
  assert.ok(s.length >= 1 && s[0].outlets >= (s[1]?.outlets ?? 0) && s[0].country);
});

import { categoryOf } from "../src/lib/intel-rank-pure.ts";
import { stormLevel } from "../src/lib/earth-layers-pure.ts";
test("categoryOf: keywords pick the kind, nothing fits = world", () => {
  assert.equal(categoryOf("Ukraine braces for new wave of attacks"), "conflict");
  assert.equal(categoryOf("Major hurricane bears down on Caribbean"), "climate");
  assert.equal(categoryOf("U.S.-China trade talks show signs of progress"), "economy");
  assert.equal(categoryOf("EU considers new sanctions"), "economy");
  assert.equal(categoryOf("President opens summit"), "politics");
  assert.equal(categoryOf("Cherry trees blossom in Tartu"), "world");
});
test("stormLevel: relative to the busiest system, so a quiet day still has colour", () => {
  assert.equal(stormLevel(3, 3).key, "crisis");
  assert.equal(stormLevel(2, 3).key, "rising");
  assert.equal(stormLevel(1, 3).key, "ongoing");
  assert.equal(stormLevel(1, 20).key, "stable");
  const w = earthWeather([h("Ukraine", 31, 49, 30, ["a", "b", "c"]), h("Chile", -71, -33, 1, ["z"])]);
  assert.ok(new Set(w.swirls.map((s) => s.color)).size >= 2, "more than one colour");
});
