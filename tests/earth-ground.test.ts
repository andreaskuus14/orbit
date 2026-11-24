import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXT, clipLine, drawGround, edgePos, groundFade, groundQuery, joinLines, landClass, metresPerUnit, parseGround, roadClass, seaPolygons, toTile, withOpenSea, type Ctx, type Pt } from "../src/lib/earth-ground-pure.ts";
import { tileBox } from "../src/lib/earth-buildings-pure.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/earth-ground-tallinn.json", import.meta.url), "utf8"));
const S = EXT;
// even-odd point-in-polygons
const inside = (polys: Pt[][], p: Pt) => { let c = false; for (const r of polys) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

test("one Overpass query per tile carries buildings and the ground", () => {
  const q = groundQuery(tileBox(9318, 4807));
  for (const k of ['way["building"]', 'way["highway"]', "coastline", 'way["landuse"]', 'way["waterway"]', "railway", "multipolygon"]) assert.ok(q.includes(k), k);
  assert.match(q, /out tags geom;$/);
});

test("road and land classes", () => {
  assert.equal(roadClass({ highway: "primary_link" }), "primary");
  assert.equal(roadClass({ highway: "residential" }), "street");
  assert.equal(roadClass({ highway: "footway" }), "path");
  assert.equal(roadClass({ highway: "proposed" }), null);
  assert.equal(roadClass({ highway: "pedestrian", area: "yes" }), null);
  assert.equal(landClass({ leisure: "park" }), "park");
  assert.equal(landClass({ natural: "wood" }), "forest");
  assert.equal(landClass({ landuse: "industrial" }), "industrial");
  assert.equal(landClass({ amenity: "cafe" }), null);
});

test("tile coordinates: corners of the tile map to 0 and EXT", () => {
  const b = tileBox(9318, 4807), T = toTile(9318, 4807);
  assert.deepEqual(T(b.w, b.n), [0, 0]);
  assert.deepEqual(T(b.e, b.s), [S, S]);
  assert.ok(metresPerUnit(59.44) > 0.29 && metresPerUnit(59.44) < 0.31); // ≈1.24 km / 4096
});

test("joinLines joins split ways, reversing only when allowed", () => {
  assert.deepEqual(joinLines([[[0, 0], [1, 0]], [[1, 0], [2, 0]]]), [[[0, 0], [1, 0], [2, 0]]]);
  assert.equal(joinLines([[[0, 0], [1, 0]], [[2, 0], [1, 0]]], true).length, 1);
  assert.equal(joinLines([[[0, 0], [1, 0]], [[2, 0], [1, 0]]], false).length, 2); // coastline direction matters
});

test("clipLine keeps the inside pieces with their ends on the edge", () => {
  const p = clipLine([[-100, 2048], [5000, 2048]]);
  assert.deepEqual(p, [[[0, 2048], [S, 2048]]]);
  const two = clipLine([[-10, 100], [100, 100], [100, -10], [200, -10], [200, 100], [300, 100]]);
  assert.equal(two.length, 2);
  assert.deepEqual(clipLine([[-5, -5], [-1, -9]]), []);
  assert.equal(edgePos([0, 0]), 0); assert.equal(edgePos([S, S]), 2); assert.equal(edgePos([10, 10]), -1);
});

test("sea from the coastline: water lies right of the line (OSM), closed clockwise along the tile edge", () => {
  // a coast running east across the middle: land north (top), sea south (bottom)
  const sea = seaPolygons([[[-50, 2048], [S + 50, 2048]]], false);
  assert.equal(sea.length, 1);
  assert.ok(inside(sea, [2048, 3500]) && !inside(sea, [2048, 500]));
  // the same line drawn westwards: the sea is north
  const north = seaPolygons([[[S + 50, 2048], [-50, 2048]]], false);
  assert.ok(inside(north, [2048, 500]) && !inside(north, [2048, 3500]));
  // a bay: the coast enters from the left edge, dips and leaves through the top
  const bay = seaPolygons([[[-10, 3000], [2000, 2000], [3000, -10]]], false);
  assert.ok(inside(bay, [3800, 3800]) && !inside(bay, [200, 200])); // heading north-east: the sea is to the south-east
  // a closed coastline ring inside the tile is an island: land inside, sea around it
  const island: Pt[] = [[1000, 1000], [1000, 3000], [3000, 3000], [3000, 1000], [1000, 1000]];
  const s2 = seaPolygons([island], false);
  assert.ok(inside(s2, [200, 200]) && !inside(s2, [2000, 2000]));
  assert.deepEqual(seaPolygons([], false), []);
  assert.equal(seaPolygons([], true).length, 1);
});

test("parse the Tallinn fixture: the harbour is sea, the old town edge is land, roads and land use present", () => {
  const { ground: g, buildings } = parseGround(fixture, 9318, 4807);
  assert.equal(buildings.length, 0); // the fixture has no buildings
  assert.ok(g.coast.length >= 1, "coastline");
  assert.ok(g.sea.length >= 1, "sea");
  assert.ok(g.roads.length > 30 && g.roads.some((r) => ["secondary", "primary", "trunk", "tertiary"].includes(r.c)), "bigger roads");
  assert.ok(g.land.some((l) => l.c === "park" || l.c === "grass" || l.c === "forest"), "green");
  // Tallinn harbour (north of the tile's middle) is water, the bottom edge near the old town is land
  const T = toTile(9318, 4807);
  assert.ok(inside(g.sea, T(24.7522, 59.4545)), "harbour water");
  assert.ok(!inside(g.sea, T(24.7522, 59.4456)), "land by the old town");
  assert.ok(g.roads.every((r) => r.l.every((p) => Number.isInteger(p[0]) && Number.isInteger(p[1]))));
});

test("open tiles: sea only where the elevation says so", () => {
  const { ground } = parseGround({ elements: [] }, 9318, 4806);
  assert.equal(ground.open, true);
  assert.equal(withOpenSea(ground, true).sea.length, 1);
  assert.equal(withOpenSea(ground, false).sea.length, 0);
  assert.equal(parseGround(fixture, 9318, 4807).ground.open, undefined);
});

test("drawGround: paints land, sea, glow and roads in order on any 2D context", () => {
  const ops: string[] = [];
  const c = { fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "", lineJoin: "", globalAlpha: 1, shadowBlur: 0, shadowColor: "",
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {},
    fill() { ops.push(`fill ${c.fillStyle}`); }, stroke() { ops.push(`stroke ${c.strokeStyle} ${c.lineWidth.toFixed(1)}`); }, fillRect() { ops.push(`rect ${c.fillStyle}`); } } as Ctx & { fillStyle: string; strokeStyle: string };
  const { ground } = parseGround(fixture, 9318, 4807);
  ground.roads.push({ c: "primary", l: [[0, 2000], [4096, 2100]] });
  const n = drawGround(c, ground, 1024, 59.44);
  assert.ok(n > 100);
  assert.equal(ops[0], "rect #0b0f15"); // dark land first
  const sea = ops.indexOf("fill #06182c"), glow = ops.findIndex((o) => o.startsWith("stroke #3d8cff")), fill = ops.findIndex((o) => o.startsWith("stroke #86b4ea") || o.startsWith("stroke #8fbef5"));
  assert.ok(sea > 0 && glow > sea && fill > glow, ops.slice(0, 20).join("|"));
  // a primary road is ~15 m: at 1024 px per ~1.24 km tile that is several px wide
  const w = Number(ops[fill].split(" ")[2]); assert.ok(w > 3 && w < 15, String(w));
});

test("the ground fades in below 12 km and is full from 6 km", () => {
  assert.equal(groundFade(20), 0); assert.equal(groundFade(12), 0);
  assert.equal(groundFade(6), 1); assert.equal(groundFade(1), 1);
  const m = groundFade(8.5); assert.ok(m > 0.2 && m < 0.8);
  assert.ok(groundFade(7) > groundFade(10));
});
