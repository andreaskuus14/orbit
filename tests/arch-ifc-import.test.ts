import { test } from "node:test";
import assert from "node:assert/strict";
import { IfcAPI, IFCBUILDING, IFCBUILDINGSTOREY, IFCPROJECT, IFCRELFILLSELEMENT, IFCRELVOIDSELEMENT, IFCSITE, IFCUNITASSIGNMENT, IFCWALL, IFCWINDOW } from "web-ifc";
import { applyOps, starterScene } from "../src/lib/arch-pure.ts";
import { toIfc } from "../src/lib/arch-ifc-pure.ts";
import { sunPosition } from "../src/lib/sun-pure.ts";
import { sunSite, dmsToDeg, ifcGroup, lengthScale, northFromTrueNorth, placeOnPlot, shadowStudyTimes } from "../src/lib/arch-ifc-import-pure.ts";
import { readIfc, type IfcModel } from "../src/lib/arch-ifc-read.ts";

test("site angles: DMS with millionths, shared sign, range checked", () => {
  assert.equal(dmsToDeg([49, 6, 1, 566000], 90), 49.100435); // FZK-Haus, Karlsruhe
  assert.equal(dmsToDeg([-71, -1, -58, -790000], 180), -71.032997);
  assert.equal(dmsToDeg([91, 0, 0], 90), null);
  assert.equal(dmsToDeg(null, 90), null);
  assert.equal(dmsToDeg(["x", 0, 0], 90), null);
});

test("true north → bearing clockwise from model −Z (IFC +Y)", () => {
  assert.equal(northFromTrueNorth([0, 1]), 0);
  assert.equal(northFromTrueNorth([1, 0]), 90);
  assert.equal(northFromTrueNorth([-1, 0]), -90);
  assert.equal(northFromTrueNorth([0, -1]), 180);
  assert.equal(northFromTrueNorth([0.766044443119, 0.642787609687]), 50);
  assert.equal(northFromTrueNorth(undefined), 0);
  assert.equal(northFromTrueNorth([0, 0]), 0);
});

test("units, groups and placement", () => {
  assert.equal(lengthScale("MILLI"), 0.001); assert.equal(lengthScale(".MILLI."), 0.001); assert.equal(lengthScale(undefined), 1);
  assert.equal(ifcGroup("IfcWallStandardCase"), "wall");
  assert.equal(ifcGroup("IFCSLAB", "ROOF"), "roof");
  assert.equal(ifcGroup("IfcSlab", "FLOOR"), "slab");
  assert.equal(ifcGroup("IfcOpeningElement"), null);
  assert.equal(ifcGroup("IfcSpace"), null);
  assert.equal(ifcGroup("IfcFurnishingElement"), "other");
  assert.deepEqual(placeOnPlot({ min: [10, -1, 20], max: [14, 6, 30] }), [-12, 0, -25]); // ground stays at IFC 0
  assert.deepEqual(placeOnPlot({ min: [0, 110, 0], max: [2, 118, 2] }), [-1, -110, -1]); // georeferenced heights: lowest point is ground
});

test("shadow-study times: 3 dates × 09/12/15 local solar time; 12:00 has the sun due south", () => {
  const t = shadowStudyTimes(2026, 24.754);
  assert.equal(t.length, 9);
  assert.deepEqual(t.map((x) => x.label.slice(0, 6)), ["21 Mar", "21 Mar", "21 Mar", "21 Jun", "21 Jun", "21 Jun", "21 Dec", "21 Dec", "21 Dec"]);
  for (const x of t.filter((x) => x.label.includes("12:00"))) assert.ok(Math.abs(sunPosition(59.437, 24.754, x.at).azimuthDeg - 180) < 5, x.label); // equation of time ≤ ~4°
  const jun = t.find((x) => x.label === "21 Jun · 12:00 solar")!;
  assert.ok(sunPosition(59.437, 24.754, jun.at).elevationDeg > 50);
});

// ---- real geometry through web-ifc, using ARCH's own IFC export as the input file ----
const api = new IfcAPI();
const ready = api.Init(undefined, true);
const read = async (step: string): Promise<IfcModel> => { await ready; return readIfc(api, new TextEncoder().encode(step)); };
const SITE = { lat: 59.437, lon: 24.754 };

test("ARCH export → import: site, storeys, element counts and sizes come back", async () => {
  const scene = starterScene(), { info, meshes } = await read(toIfc(scene, { site: SITE, time: new Date(0) }));
  assert.equal(info.schema, "IFC4");
  assert.deepEqual(info.site, SITE);
  assert.equal(info.north, 0);
  assert.ok(info.storeys.length >= 1);
  assert.equal(info.counts.wall, 4); // the starter's shell is written as four walls
  for (const g of ["slab", "roof", "wall"] as const) assert.ok(meshes[g]?.indices.length, g);
  // the walls' footprint is the starter shell (10 × 8 m), centred on the plot, standing on the ground
  const p = meshes.wall!.positions, ax = (q: number) => { let lo = Infinity, hi = -Infinity; for (let i = q; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return [lo, hi]; };
  const wall = scene.parts.find((x) => x.kind === "wall")!, [x0, x1] = ax(0), [y0, y1] = ax(1), [z0, z1] = ax(2);
  assert.ok(Math.abs(x1 - x0 - wall.w) < 1e-3 && Math.abs(z1 - z0 - wall.d) < 1e-3, `${x1 - x0} × ${z1 - z0}`);
  assert.ok(Math.abs(y0 - wall.y) < 1e-3 && Math.abs(y1 - (wall.y + wall.h)) < 1e-3);
  assert.ok(info.size.every((v) => v > 0 && v < 30));
});

test("web-ifc (outside parser) finds the required IFC4 structure in ARCH's export", async () => {
  await ready;
  const scene = applyOps(starterScene(), [{ op: "add", kind: "window", host: starterScene().parts.find((p) => p.kind === "wall")!.id, face: "s", w: 1.2 }], () => "w1").scene;
  const m = api.OpenModel(new TextEncoder().encode(toIfc(scene, { site: SITE, time: new Date(0) })));
  try {
    const n = (t: number) => api.GetLineIDsWithType(m, t).size(), line = (id: number) => api.GetLine(m, id);
    for (const [t, name] of [[IFCPROJECT, "project"], [IFCSITE, "site"], [IFCBUILDING, "building"], [IFCBUILDINGSTOREY, "storey"], [IFCUNITASSIGNMENT, "units"]] as const) assert.ok(n(t) >= 1, name);
    assert.equal(n(IFCWALL), 4);
    const voids = api.GetLineIDsWithType(m, IFCRELVOIDSELEMENT), fills = api.GetLineIDsWithType(m, IFCRELFILLSELEMENT);
    assert.equal(voids.size(), 1); assert.equal(fills.size(), 1);
    const v = line(voids.get(0)), f = line(fills.get(0));
    assert.equal(api.GetLineType(m, v.RelatingBuildingElement.value), IFCWALL);
    assert.equal(f.RelatingOpeningElement.value, v.RelatedOpeningElement.value);
    assert.equal(api.GetLineType(m, f.RelatedBuildingElement.value), IFCWINDOW);
  } finally { api.CloseModel(m); }
});

test("a rotated true north and millimetre units are honoured", async () => {
  const step = toIfc(starterScene(), { site: SITE, time: new Date(0) });
  const rotated = step.replace(/IFCGEOMETRICREPRESENTATIONCONTEXT\(\$,'Model',3,1\.E-05,(#\d+),\$\)/, "IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,$1,#90000)")
    .replace("ENDSEC;\nEND-ISO", "#90000=IFCDIRECTION((0.766044443119,0.642787609687));\nENDSEC;\nEND-ISO");
  assert.notEqual(rotated, step);
  assert.equal((await read(rotated)).info.north, 50);
  // same numbers read as millimetres: geometry and storey elevations both shrink 1000× (no mixed units)
  const m = await read(step), mm = await read(step.replace("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)", "IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"));
  const width = (x: IfcModel) => { const p = x.meshes.wall!.positions; let lo = Infinity, hi = -Infinity; for (let i = 0; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return hi - lo; };
  assert.ok(Math.abs(width(mm) * 1000 - width(m)) < 1e-3, `${width(mm)} vs ${width(m)}`);
  assert.deepEqual(mm.info.storeys.map((s) => s.elevation), m.info.storeys.map((s) => Math.round(s.elevation) / 1000 || 0));
});

test("refuses oversized and empty files with a plain message", async () => {
  await ready;
  assert.throws(() => readIfc(api, { byteLength: 200 * 1048576 } as Uint8Array), /up to 80 MB/);
  const empty = toIfc({ ...starterScene(), parts: [] }, { time: new Date(0) });
  await assert.rejects(read(empty), /No building geometry/);
});

test("an IFC's site drives the sun only while open; his own location is never changed", () => {
  const own = { lat: 59.437, lon: 24.754, hour: 12, on: true }, file = { lat: 49.100435, lon: 8.436539 };
  assert.equal(sunSite(file, own), file);
  assert.equal(sunSite(null, own), own);
  assert.equal(sunSite(undefined, own), own, "closed (or no site in the file): back to his own, nothing to restore");
  assert.deepEqual(own, { lat: 59.437, lon: 24.754, hour: 12, on: true });
});
