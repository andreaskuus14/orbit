import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BZ, capBuildings, earcut2, extrude, heightOf, overpassQuery, parseOverpass, tileBox, tilesAround, validBTile } from "../src/lib/earth-buildings-pure.ts";
import { lat2y, lon2x } from "../src/lib/earth-pure.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/earth-overpass-tallinn.json", import.meta.url), "utf8"));

test("heights from OSM tags", () => {
  assert.equal(heightOf({ building: "yes", height: "12.5" }).h, 12.5);
  assert.equal(heightOf({ building: "yes", height: "12,5 m" }).h, 12.5);
  assert.ok(Math.abs(heightOf({ building: "yes", height: "30 ft" }).h - 9.144) < 1e-6);
  assert.equal(heightOf({ building: "yes", "building:levels": "4" }).h, 13);
  assert.equal(heightOf({ building: "yes", "building:levels": "4", "roof:levels": "1" }).h, 14);
  assert.equal(heightOf({ building: "house" }).h, 7);
  assert.equal(heightOf({ building: "yes", height: "nonsense" }).h, 8);
  assert.equal(heightOf({ building: "yes", height: "9000" }).h, 400);
  assert.deepEqual(heightOf({ building: "yes", height: "20", min_height: "5" }), { h: 20, min: 5 });
});

test("Overpass JSON → closed CCW footprints; the real Tallinn fixture parses", () => {
  const sq = (o: number) => [[0, 0], [0, 1e-3], [1e-3, 1e-3], [1e-3, 0], [0, 0]].map(([x, y]) => ({ lon: 24.7 + x + o, lat: 59.4 + y }));
  const b = parseOverpass({ elements: [
    { type: "way", tags: { building: "yes" }, geometry: sq(0) }, // clockwise → reversed
    { type: "way", tags: { building: "roof" }, geometry: sq(0.01) },
    { type: "way", tags: { building: "yes" }, geometry: sq(0.02).slice(0, 4) }, // not closed
    { type: "way", tags: { highway: "x" }, geometry: sq(0.03) },
    { type: "node", tags: { building: "yes" } },
  ] });
  assert.equal(b.length, 1); assert.equal(b[0].r.length, 4);
  const a = b[0].r.reduce((s, p, i, r) => s + (p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]), 0);
  assert.ok(a > 0, "counter-clockwise");
  const real = parseOverpass(fixture);
  assert.ok(real.length >= 200, `${real.length} buildings`);
  assert.ok(real.some((x) => x.h >= 20) && real.some((x) => x.h < 10), "tall and low buildings");
  assert.equal(parseOverpass(null).length, 0);
  assert.match(overpassQuery(tileBox(Math.floor(lon2x(24.745, BZ)), Math.floor(lat2y(59.437, BZ)))), /way\["building"\]\(59\.\d+,24\.\d+,59\.\d+,24\.\d+\)/);
});

test("GPU cap keeps the biggest", () => {
  const real = parseOverpass(fixture), c = capBuildings(real, 50);
  assert.equal(c.length, 50);
  assert.equal(capBuildings(real.slice(0, 10), 50).length, 10);
});

test("tiles around a look point: none above 25 km, nearest first", () => {
  assert.equal(tilesAround(24.745, 59.437, 30).length, 0);
  const t = tilesAround(24.745, 59.437, 5);
  assert.ok(t.length >= 4 && t.length <= 25);
  assert.deepEqual(t[0], { x: Math.floor(lon2x(24.745, BZ)), y: Math.floor(lat2y(59.437, BZ)) });
  assert.ok(t.every((x) => validBTile(x.x, x.y)));
  assert.ok(!validBTile(-1, 0) && !validBTile(1.5, 0) && !validBTile(2 ** BZ, 0));
});

test("ear clipping triangulates concave footprints", () => {
  const L: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const t = earcut2(L);
  assert.equal(t.length, 3 * (L.length - 2));
  const area = (i: number) => { const [a, b, c] = [L[t[i]], L[t[i + 1]], L[t[i + 2]]]; return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; };
  let s = 0; for (let i = 0; i < t.length; i += 3) { assert.ok(area(i) > 0); s += area(i); }
  assert.ok(Math.abs(s - 3) < 1e-9, "covers the L exactly");
});

test("extrusion: walls + roof, heights in metres, relative to the tile centre", () => {
  const r: [number, number][] = [[24.745, 59.437], [24.746, 59.437], [24.746, 59.4375], [24.745, 59.4375]];
  const e = extrude([{ r, h: 20, min: 0 }], { lon: 24.7455, lat: 59.43725 }, () => 100, 1, 10);
  assert.equal(e.count, 1);
  assert.equal(e.positions.length / 3, 4 * 4 + 4); // 4 wall quads + 4 roof verts
  assert.equal(e.index.length, 4 * 6 + 2 * 3);
  const M = 6371000, len = (i: number) => Math.hypot(e.positions[i * 3] + e.origin[0], e.positions[i * 3 + 1] + e.origin[1], e.positions[i * 3 + 2] + e.origin[2]);
  assert.ok(Math.abs((len(0) - 1) * M - 90) < 0.5, "wall foot sunk 10 m below the 100 m ground");
  assert.ok(Math.abs((len(16) - 1) * M - 120) < 0.5, "roof at ground + 20 m");
  assert.ok(Math.max(...e.positions.map(Math.abs)) < 1e-4, "relative positions stay small (float32-precise)");
  // wall normals point outward: the south wall (first edge, going east) faces south
  const n = [e.normals[0], e.normals[1], e.normals[2]], up = [e.origin[0], e.origin[1], e.origin[2]];
  assert.ok(Math.abs(n[0] * up[0] + n[1] * up[1] + n[2] * up[2]) < 1e-6, "wall normal is horizontal");
  assert.ok(n[1] < 0, "faces south (away from the pole)");
  for (let i = 16 * 3; i < e.normals.length; i += 3) assert.ok(e.normals[i] * up[0] + e.normals[i + 1] * up[1] + e.normals[i + 2] * up[2] > 0.99);
  // wall coordinates: metres along the wall and up from the ground (real, unexaggerated), plus the building's height
  assert.equal(e.wall.length, e.positions.length);
  assert.deepEqual([...e.wall.slice(0, 3)], [0, -10, 20]);
  assert.ok(Math.abs(e.wall[3] - 56.6) < 1, "first edge ≈ 57 m long (0.001° of longitude at 59.4°N)");
  assert.equal(e.wall[3 * 2 + 1], 20, "wall top at the building's height");
  assert.ok(Math.abs(e.wall[3 * 4] - e.wall[3]) < 1e-3, "the next wall starts where the last one ended");
  const tall = extrude([{ r, h: 20, min: 0 }], { lon: 24.7455, lat: 59.43725 }, () => 0, 1.6, 10);
  assert.equal(tall.wall[3 * 2 + 1], 20, "exaggeration does not change the window grid");
  const full = extrude(parseOverpass(fixture), { lon: 24.745, lat: 59.437 });
  assert.ok(full.index.length % 3 === 0 && full.index.every((i) => i < full.positions.length / 3));
});
