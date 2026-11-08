import { test } from "node:test";
import assert from "node:assert/strict";
import { boq, fitOpening, isOpening, MAX, type Scene } from "../src/lib/arch-pure.ts";
import { toIfc } from "../src/lib/arch-ifc-pure.ts";
import { checkIfc } from "../src/lib/arch-export-pure.ts";
import { insertGroup, kitGroups, kitHouse, partTree, replaceOpening } from "../src/lib/arch-kit-pure.ts";
import { daylightPlan } from "../src/lib/arch-daylight-pure.ts";

let n = 0; const newId = () => `t${++n}`;
const SITE = { lat: 59.437, lon: 24.754 };

test("kit house: assembled, named, every opening fits its host wall, under the part cap", () => {
  const h = kitHouse();
  assert.equal(h.parts.length, 29);
  assert.ok(h.parts.length <= MAX.parts);
  assert.equal(new Set(h.parts.map((p) => p.id)).size, h.parts.length);
  for (const p of h.parts) assert.match(p.name, / · /, p.id);
  for (const o of h.parts.filter((p) => isOpening(p.kind))) {
    const wall = h.parts.find((w) => w.id === o.host);
    assert.ok(fitOpening(o, wall), o.name);
    assert.deepEqual(fitOpening(o, wall), o, `${o.name} was clamped: fix its kit size`);
  }
  // props stand on the slab (interior) or the ground (exterior), and stay inside the shell / outside it
  for (const p of h.parts.filter((q) => q.kind === "prop")) assert.equal(p.y, p.group === "interior" ? 0.2 : 0, p.name);
  for (const p of h.parts.filter((q) => q.group === "interior")) assert.ok(Math.abs(p.x) + p.w / 2 <= 4.7 + 1e-9 && Math.abs(p.z) + p.d / 2 <= 3.7 + 1e-9, p.name);
});

test("hierarchy: structure / interior / exterior, then subgroups", () => {
  const t = partTree(kitHouse().parts);
  assert.deepEqual(t.map((g) => g.group), ["structure", "interior", "exterior"]);
  assert.deepEqual(t[0].subs.map((s) => s.name), ["Shell", "Openings"]);
  assert.deepEqual(t[1].subs.map((s) => s.name), ["Kitchen", "Dining", "Living", "Bedroom"]);
  assert.equal(t[1].subs[1].parts.length, 5); // table + 4 chairs
});

test("props are furniture: no quantities, no daylight blocking, not in the IFC, and IFC still checks out", () => {
  const h = kitHouse(), bare: Scene = { ...h, parts: h.parts.filter((p) => p.kind !== "prop") };
  assert.deepEqual(boq(h.parts), boq(bare.parts));
  assert.equal(daylightPlan(h.parts).boxes.length, daylightPlan(bare.parts).boxes.length);
  const ifc = toIfc(h, { site: SITE, time: new Date(0) });
  assert.ok(checkIfc(ifc, h, { site: SITE }).every((c) => c.ok), JSON.stringify(checkIfc(ifc, h, { site: SITE }).filter((c) => !c.ok)));
});

test("replace a window: same id, host, face and offset; wall opening and IFC void follow the new size", () => {
  const h = kitHouse(), before = h.parts.find((p) => p.id === "k-w-west")!;
  const r = replaceOpening(h, "k-w-west", "W24"), after = r.parts.find((p) => p.id === "k-w-west")!;
  assert.deepEqual([after.host, after.face, after.off, after.kind], [before.host, before.face, before.off, "window"]);
  assert.deepEqual([after.w, after.h], [2.4, 1.2]);
  assert.equal(after.name, "Openings · west window (W24)");
  assert.equal(r.parts.length, h.parts.length);
  const ifc = toIfc(r, { site: SITE, time: new Date(0) });
  assert.ok(checkIfc(ifc, r, { site: SITE }).every((c) => c.ok));
  assert.equal((ifc.match(/IFCOPENINGELEMENT\(/g) ?? []).length, 7); // every opening still voids its wall
  assert.equal(replaceOpening(h, "k-w-west", "D09"), h, "a window can't become a door");
  assert.equal(replaceOpening(h, "k-counter", "W12"), h, "only openings are replaced");
});

test("reuse a group in a blank scene: fresh ids, centred where asked, nothing from the house leaks in", () => {
  const groups = kitGroups(), dining = groups.find((g) => g.name === "Dining")!;
  assert.ok(!groups.some((g) => g.name === "Openings"), "openings need their house wall, so they aren't a stand-alone group");
  const blank: Scene = { plot: { w: 30, d: 25, ground: "grass", trees: 0 }, parts: [] };
  const s = insertGroup(blank, dining.parts, { x: 5, z: -2 }, newId);
  assert.equal(s.parts.length, 5);
  assert.ok(s.parts.every((p) => p.id.startsWith("t") && p.group === "interior"));
  const xs = s.parts.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]), zs = s.parts.flatMap((p) => [p.z - p.d / 2, p.z + p.d / 2]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 5) < 1e-9 && Math.abs((Math.min(...zs) + Math.max(...zs)) / 2 + 2) < 1e-9);
  assert.equal(insertGroup(kitHouse(), Array(60).fill(dining.parts).flat(), { x: 0, z: 0 }, newId).parts.length, 29, "part cap");
});

test("a wall + its hosted opening copies with the opening re-hosted on the copy", () => {
  const h = kitHouse(), wall = h.parts.find((p) => p.id === "k-part")!, door = h.parts.find((p) => p.id === "k-d-bed")!;
  const s = insertGroup({ ...h, parts: [] }, [wall, door], { x: 0, z: 0 }, newId);
  const w2 = s.parts.find((p) => p.kind === "wall")!, d2 = s.parts.find((p) => p.kind === "door")!;
  assert.equal(d2.host, w2.id);
  assert.notEqual(w2.id, "k-part");
});

test("save → reopen: the scene JSON round-trips groups and props unchanged", () => {
  const h = replaceOpening(kitHouse(), "k-w-kit", "W06");
  assert.deepEqual(JSON.parse(JSON.stringify(h)), h);
});
