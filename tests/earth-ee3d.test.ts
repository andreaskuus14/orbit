import { test } from "node:test";
import assert from "node:assert/strict";
import { EZ, buildMesh, decodeMesh, eeTilesAround, encodeMesh, fromLest, inEstonia, mergeMeshes, munisFor, parseBuildings, splitBuildings, tileOf, toLest, tris, validETile, validOrtho, withinBudget, orthoTiles, TRI_BUDGET } from "../src/lib/earth-ee3d-pure.ts";
import { coveredRadius, isCrown, treeSpots, wallTint } from "../src/lib/earth-ee3d-look-pure.ts";
import { lat2y, lon2x } from "../src/lib/earth-pure.ts";

test("L-EST97 round trip and known places", () => {
  for (const [lon, lat] of [[24.745, 59.437], [26.72, 58.38], [22.5, 58.25], [27.9, 59.37]]) {
    const [n, e] = toLest(lon, lat), [lo, la] = fromLest(n, e);
    assert.ok(Math.abs(lo - lon) < 1e-8 && Math.abs(la - lat) < 1e-8);
  }
  // the projection's own origin: false easting/northing at 24° E, 57.5175539° N
  const [n0, e0] = toLest(24, 57 + 31 / 60 + 3.19415 / 3600); assert.ok(Math.abs(n0 - 6375000) < 0.01 && Math.abs(e0 - 500000) < 0.01);
  const [n, e] = toLest(24.745, 59.437); assert.ok(Math.abs(n - 6589031) < 5 && Math.abs(e - 542275) < 5); // Tallinn old town
});

test("Estonia gate and tiles", () => {
  assert.ok(inEstonia(24.745, 59.437)); assert.ok(inEstonia(22.77, 58.83)); // Tallinn, Käina
  assert.ok(!inEstonia(24.1, 56.95)); assert.ok(!inEstonia(2.35, 48.85)); // Riga, Paris
  const x = Math.floor(lon2x(24.745, EZ)), y = Math.floor(lat2y(59.437, EZ));
  assert.deepEqual(munisFor(x, y), ["Tallinn"]); assert.ok(validETile(x, y)); assert.ok(!validETile(1.5, y));
  const ts = eeTilesAround(24.745, 59.437, 1.2);
  assert.ok(ts.length >= 9 && ts.length <= 25); assert.equal(ts[0].x, x); assert.equal(ts[0].z, 18);
  assert.ok(ts.every((t, i) => !i || ts[i - 1].d <= t.d));
  assert.equal(eeTilesAround(24.745, 59.437, 30).length, 0);
  assert.ok(validOrtho(18, 149090, 76939)); assert.ok(!validOrtho(19, 298181, 153879)); assert.ok(!validOrtho(18, 0, 0));
  assert.deepEqual(orthoTiles(x, y, 18), { x0: x * 8, y0: y * 8, n: 8 });
});

test("triangle budget keeps the nearest tiles", () => {
  const ts = [{ tris: 2e6 }, { tris: 0.9e6 }, { tris: 0.5e6 }];
  assert.equal(withinBudget(ts).length, 2); assert.equal(withinBudget(ts, 1e9).length, 3); assert.equal(TRI_BUDGET, 3e6);
});

// a gabled house (8 m x 6 m, walls 5 m, ridge 8 m) near Tallinn town hall, in the Land Board's CityGML shape
const [N0, E0] = toLest(24.7454, 59.4372);
const ring = (pts: number[][]) => `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${[...pts, pts[0]].map(([e, n, h]) => `${N0 + n} ${E0 + e} ${h}`).join(" ")}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
const house = `<bldg:Building gml:id="b1"><bldg:lod2MultiSurface><gml:MultiSurface>${[
  [[0, 0, 20], [8, 0, 20], [8, 0, 25], [0, 0, 25]], [[8, 6, 20], [0, 6, 20], [0, 6, 25], [8, 6, 25]], // long walls
  [[0, 6, 20], [0, 0, 20], [0, 0, 25], [0, 3, 28], [0, 6, 25]], [[8, 0, 20], [8, 6, 20], [8, 6, 25], [8, 3, 28], [8, 0, 25]], // gable ends
  [[0, 0, 25], [8, 0, 25], [8, 3, 28], [0, 3, 28]], [[8, 6, 25], [0, 6, 25], [0, 3, 28], [8, 3, 28]], // roof
  [[0, 0, 20], [0, 6, 20], [8, 6, 20], [8, 0, 20]], // floor (left out)
].map(ring).join("")}</gml:MultiSurface></bldg:lod2MultiSurface></bldg:Building>`;

test("CityGML building -> flat-shaded mesh with roofs and walls", () => {
  const xml = `<core:cityObjectMember>${house}</core:cityObjectMember><core:cityObjectMember><bldg:Building gml:id="b2">`;
  const [whole, rest] = splitBuildings(xml); assert.ok(rest.includes("b2") && whole.endsWith("</bldg:Building>"));
  const bs = parseBuildings(whole); assert.equal(bs.length, 1); assert.equal(bs[0].rings.length, 7);
  const t = tileOf(bs[0]), m = buildMesh(bs, t.x, t.y);
  assert.equal(m.nB, 1); assert.equal(tris(m), 2 * 2 + 2 * 3 + 2 * 2); // two long walls, two pentagon gable ends, two roof faces (floor left out)
  const kinds = Array.from({ length: m.pos.length / 3 }, (_, i) => m.nrm[i * 4 + 3]);
  assert.equal(kinds.filter(Boolean).length, 8); // two roof faces, 4 points each
  assert.ok(Math.abs(Math.max(...Array.from({ length: m.pos.length / 3 }, (_, i) => m.pos[i * 3 + 2])) - 8) < 1e-6); // ridge 8 m above the base
  assert.ok(Math.abs(m.bld[2] - 20) < 1e-6);
  // every triangle faces the way its face's normal points (outward)
  for (let i = 0; i < m.idx.length; i += 3) {
    const P = [0, 1, 2].map((k) => [0, 1, 2].map((c) => m.pos[m.idx[i + k] * 3 + c])), n = [0, 1, 2].map((c) => m.nrm[m.idx[i] * 4 + c]);
    const u = P[1].map((v, c) => v - P[0][c]), w = P[2].map((v, c) => v - P[0][c]), cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    assert.ok(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0);
  }
  // outward: the south wall (n = 0) points south
  const south = Array.from({ length: m.pos.length / 3 }, (_, i) => i).find((i) => m.nrm[i * 4 + 1] < -100); assert.ok(south !== undefined);
  // binary round trip and merge
  const d = decodeMesh(encodeMesh(m))!; assert.deepEqual(Array.from(d.idx), Array.from(m.idx)); assert.ok(Math.abs(d.lat - m.lat) < 1e-12);
  const mm = mergeMeshes([m, d])!; assert.equal(mm.nB, 2); assert.equal(tris(mm), 2 * tris(m)); assert.equal(mm.bStart[1], m.pos.length / 3);
  assert.equal(decodeMesh(new Uint8Array(10)), null);
});

test("roof with a courtyard hole is triangulated around it", () => {
  const sq = (s: number, h: number) => [[-s, -s, h], [s, -s, h], [s, s, h], [-s, s, h]].map(([e, n, z]) => `${N0 + n} ${E0 + e} ${z}`).join(" ");
  const xml = `<bldg:Building gml:id="c"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${sq(20, 30)}</gml:posList></gml:LinearRing></gml:exterior><gml:interior><gml:LinearRing><gml:posList>${sq(8, 30).split(" ").join(" ")}</gml:posList></gml:LinearRing></gml:interior></gml:Polygon></bldg:Building>`;
  const bs = parseBuildings(xml), t = tileOf(bs[0]), m = buildMesh(bs, t.x, t.y);
  let area = 0;
  for (let i = 0; i < m.idx.length; i += 3) { const [a, b, c] = [0, 1, 2].map((k) => m.idx[i + k] * 3); area += Math.abs((m.pos[b] - m.pos[a]) * (m.pos[c + 1] - m.pos[a + 1]) - (m.pos[c] - m.pos[a]) * (m.pos[b + 1] - m.pos[a + 1])) / 2; }
  assert.ok(Math.abs(area - (40 * 40 - 16 * 16)) < 30, `area ${area}`); // local metres are spherical approximations: allow ~2%
});

test("wall tints and trees from the photo", () => {
  assert.deepEqual(wallTint(5, 10), wallTint(5, 10)); assert.ok(wallTint(5, 40).every((v) => v > 0.3));
  assert.ok(!isCrown(200, 60, 50)); // red roof
  const W = 64, px = new Uint8ClampedArray(W * W * 4), roof = new Uint8Array(W * W);
  for (let i = 0; i < W * W; i++) { const left = i % W < 32; px.set(left ? [55, 85, 45, 255] : [130, 130, 128, 255], i * 4); }
  const ts = treeSpots(px, W, roof, 8, 0.3);
  assert.ok(ts.length >= 6 && ts.every((t) => t.u < 0.5)); assert.ok(ts.every((t) => t.h > t.r && t.r >= 1.8));
  roof.fill(1); assert.equal(treeSpots(px, W, roof, 8, 0.3).length, 0);
});

test("loaded-area radius", () => {
  assert.equal(coveredRadius(10.5, 10.5, () => false), 0);
  assert.equal(coveredRadius(10.5, 10.5, () => true, 4), 4);
  const r = coveredRadius(10.5, 10.5, (x, y) => Math.abs(x - 10) <= 1 && Math.abs(y - 10) <= 1); // 3×3 loaded
  assert.ok(Math.abs(r - 1.5) < 1e-9);
});
test("lower camera floor only in Estonia", async () => {
  const { clampAltAt } = await import("../src/lib/earth-ee3d-pure.ts");
  assert.equal(clampAltAt(0.1, 24.745, 59.437), 0.3); assert.equal(clampAltAt(0.1, 2.35, 48.85), 1); assert.equal(clampAltAt(5, 24.745, 59.437), 5);
});
test("store answers pending at once on a first visit, then serves the tile", async () => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const path = await import("node:path");
  const { tileMesh } = await import("../src/lib/earth-ee3d-store.ts");
  const root = mkdtempSync(path.join(tmpdir(), "ee3d-"));
  // a one-entry deflated zip holding the test house, served by a fake fetch
  const zlib = await import("node:zlib"), gml = Buffer.from(`<core:CityModel>${house}</core:CityModel>`), data = zlib.deflateRawSync(gml), name = Buffer.from("h.gml");
  const hdr = Buffer.alloc(30); hdr.writeUInt32LE(0x04034b50, 0); hdr.writeUInt16LE(8, 8); hdr.writeUInt16LE(name.length, 26);
  let calls = 0; const get = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return new Response(Buffer.concat([hdr, name, data])); };
  const bs = parseBuildings(house), t = tileOf(bs[0]);
  const t0 = Date.now(); assert.equal(await tileMesh(root, t.x, t.y, get), "pending"); assert.ok(Date.now() - t0 < 40);
  const m = await tileMesh(root, t.x, t.y, get, true); assert.ok(m && m !== "pending"); assert.equal((m as { nB: number }).nB, 1);
  assert.equal(calls, 1); // one download per municipality
});
