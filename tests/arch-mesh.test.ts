import { test } from "node:test";
import assert from "node:assert/strict";
import { cutFace, houseMesh, pitchOf, roofBase, roofTop, siteLayout, frontDoor, isOuterWall, propMat, type MeshGroup } from "../src/lib/arch-mesh-pure.ts";
import { applyOps, fitOpenings, starterScene, type Part, type Scene } from "../src/lib/arch-pure.ts";

const shell: Part = { id: "w", kind: "wall", name: "Walls", x: 0, y: 0.2, z: 0, w: 10, d: 8, h: 2.8 };
const roof = (o: Partial<Part> = {}): Part => ({ id: "r", kind: "roof", name: "Roof", x: 0, y: 3, z: 0, w: 10.6, d: 9, h: 2.8, ...o });
const scene = (parts: Part[], extra: Partial<Scene> = {}): Scene => ({ plot: { w: 30, d: 25, ground: "grass", trees: 6 }, parts: fitOpenings(parts), ...extra });
const win = (o: Partial<Part> = {}): Part => ({ id: "o1", kind: "window", name: "Window", host: "w", face: "s", off: 0, sill: 0.9, x: 0, y: 0, z: 0, w: 1.2, d: 0, h: 1.2, ...o });
const bounds = (g: MeshGroup[]) => { const ys = g.flatMap((x) => x.pos.filter((_, i) => i % 3 === 1)); return [Math.min(...ys), Math.max(...ys)]; };
const of = (m: ReturnType<typeof houseMesh>, mat: string) => m.groups.filter((g) => g.mat === mat);

test("cutFace: a wall face minus a window = left, right, under and over pieces, and the areas add up", () => {
  const r = cutFace(0, 4, 0, 3, [{ u0: 1.5, u1: 2.5, y0: 1, y1: 2 }]);
  const area = r.reduce((s, x) => s + (x.u1 - x.u0) * (x.y1 - x.y0), 0);
  assert.ok(Math.abs(area - (12 - 1)) < 1e-9);
  assert.equal(r.length, 4);
  assert.deepEqual(cutFace(0, 4, 0, 3, []), [{ u0: 0, u1: 4, y0: 0, y1: 3 }]);
  // a door to the floor leaves no piece under it; two windows side by side share the strips between
  assert.equal(cutFace(0, 4, 0, 3, [{ u0: 1, u1: 2, y0: 0, y1: 2.1 }]).length, 3);
  assert.ok(Math.abs(cutFace(0, 6, 0, 3, [{ u0: 1, u1: 2, y0: 1, y1: 2 }, { u0: 4, u1: 5, y0: 1, y1: 2 }]).reduce((s, x) => s + (x.u1 - x.u0) * (x.y1 - x.y0), 0) - 16) < 1e-9);
});

test("a shell is four walls with real thickness, not a solid box: nothing fills the inside", () => {
  const m = houseMesh(scene([shell]));
  const p = of(m, "plaster")[0].pos;
  for (let i = 0; i < p.length; i += 3) {
    const inside = Math.abs(p[i]) < 5 - 0.3 - 1e-6 && Math.abs(p[i + 2]) < 4 - 0.3 - 1e-6;
    assert.ok(!inside, `vertex inside the rooms at ${p[i]}, ${p[i + 2]}`);
  }
});

test("a window is a hole with reveals, a frame set back, glass, an outside sill and an inside board", () => {
  const m = houseMesh(scene([shell, win()]));
  assert.ok(of(m, "glass").length && of(m, "frame").length && of(m, "sill").length && of(m, "inner").length);
  const g = of(m, "glass")[0].pos, zs = g.filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...zs) < 4 - 0.1, "glass sits back from the outer face (in the reveal)");
  assert.ok(Math.min(...zs) > 4 - 0.3, "and inside the wall's thickness");
  const wide = houseMesh(scene([shell, win({ w: 2.4 })])), narrow = houseMesh(scene([shell, win()]));
  assert.ok(of(wide, "frame")[0].tri.length > of(narrow, "frame")[0].tri.length, "a wide window gets mullions");
  assert.ok(of(m, "glass")[0].tri.every((id) => id === "o1"), "glass picks the window");
});

test("doors: exterior gets a dark plank leaf, handle and threshold; interior a light panelled leaf", () => {
  const front: Part = { id: "d1", kind: "door", name: "Front door", host: "w", face: "s", off: 2, x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 };
  const part: Part = { id: "pw", kind: "wall", name: "Partition", x: 0, y: 0.2, z: 0, w: 0.12, d: 7.4, h: 2.8 };
  const inner: Part = { id: "d2", kind: "door", name: "Door", host: "pw", face: "e", off: 0, x: 0, y: 0, z: 0, w: 0.9, d: 0, h: 2.1 };
  const m = houseMesh(scene([shell, part, front, inner]));
  assert.ok(of(m, "doorExt").length && of(m, "doorInt").length && of(m, "metal").length);
  assert.equal(of(m, "inner")[0].tri.filter((t) => t === "pw").length > 0, true, "a partition is white plaster, not facade");
});

test("roofs: each form is built, sits on the walls, and the gable triangles are filled in the wall plane", () => {
  for (const form of ["gable", "hip", "shed", "flat"] as const) {
    const s = scene([shell, roof({ roof: form, pitch: form === "flat" ? 0 : form === "shed" ? 12 : 35 })]);
    const m = houseMesh(s), lifted = m.groups.filter((g) => g.lift === "r");
    assert.ok(lifted.length, `${form}: roof meshes tagged for lifting`);
    assert.ok(!m.groups.some((g) => g.pos.some((v) => !Number.isFinite(v))), `${form}: finite`);
    const [lo, hi] = bounds(lifted);
    assert.ok(lo > 2.5 && hi <= roofTop(s.parts[1], s.parts) + 0.06, `${form}: between ${lo} and ${hi}`);
    if (form === "flat") assert.ok(of(m, "coping").length, "flat roof has a parapet with coping");
    else assert.ok(of(m, "gutter").length && of(m, "fascia").length, `${form}: gutters and fascia`);
  }
  const g = houseMesh(scene([shell, roof({ roof: "gable", pitch: 35 })]));
  const gable = g.groups.filter((x) => x.lift === null && x.mat === "plaster" && x.tri.includes("r"));
  assert.ok(gable.length, "gable triangles are wall (not lifted with the roof)");
});

test("roof geometry: base from the walls under it, pitch from the part, the old flat rule kept", () => {
  const parts = [shell, roof()];
  assert.deepEqual(roofBase(parts[1], parts), { x0: -5, x1: 5, z0: -4, z1: 4 });
  assert.equal(pitchOf(roof({ pitch: 40 })), 40);
  assert.ok(Math.abs(pitchOf(roof({ h: 4.5 / Math.sqrt(3), d: 9 })) - 30) < 0.01, "h over half the span across the ridge");
  const old = houseMesh(scene([shell, roof({ h: 0.3 })]));
  assert.ok(of(old, "roofMembrane").length, "a low roof with no form is flat, as before");
});

test("the starter scene and a fully edited scene build without NaN, under 20k triangles", () => {
  const m = houseMesh(starterScene());
  assert.ok(m.tris > 50 && m.tris < 20_000);
  const s = applyOps(starterScene(), [{ op: "add", kind: "window", host: "p3", face: "s", w: 1.5 }, { op: "add", kind: "door", host: "p3", face: "n", w: 1 }, { op: "roof", id: "p4", form: "hip" }, { op: "style", facade: "timber" }], () => "n" + Math.random()).scene;
  const m2 = houseMesh(s);
  assert.ok(of(m2, "timber").length && of(m2, "trim").length, "timber facade with corner boards");
  assert.ok(!m2.groups.some((g) => g.pos.some((v) => !Number.isFinite(v))));
  assert.ok(m2.groups.every((g) => g.pos.length === g.nor.length && g.uv.length / 2 === g.pos.length / 3 && g.tri.length * 9 === g.pos.length));
});

test("hidden roof and failing parts", () => {
  const s = scene([shell, roof()]);
  assert.ok(!houseMesh(s, { hideRoof: true }).groups.some((g) => g.lift));
  assert.ok(of(houseMesh(s, { fail: new Set(["w"]) }), "fail").length);
});

test("site: gravel strip round the house, a path from the front door to the plot edge, trees kept off house and path", () => {
  const door: Part = { id: "d", kind: "door", name: "Front door", host: "w", face: "s", off: 0, x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 };
  const s = scene([{ id: "sl", kind: "slab", name: "Slab", x: 0, y: 0, z: 0, w: 10, d: 8, h: 0.2 }, shell, door], { plot: { w: 30, d: 25, ground: "grass", trees: 20 } });
  const L = siteLayout(s);
  assert.equal(frontDoor(s.parts)?.id, "d");
  assert.equal(L.gravel.length, 4);
  assert.ok(L.path && L.path.z0 === 4 && L.path.z1 === 12.5);
  assert.ok(L.trees.length > 5 && L.trees.every((t) => Math.abs(t.x) > 5 + 3 || Math.abs(t.z) > 4 + 3));
  assert.ok(L.trees.every((t) => !(Math.abs(t.x) < 0.6 + 2.2 && t.z > 4)), "no tree on the path");
});

test("outer walls and prop finishes", () => {
  assert.ok(isOuterWall(shell));
  assert.ok(isOuterWall({ ...shell, w: 8, d: 0.3, name: "North wall a" }));
  assert.ok(!isOuterWall({ ...shell, w: 8, d: 0.12, name: "Partition" }));
  assert.equal(propMat("Entrance canopy"), "roofMetal");
  assert.equal(propMat("Sofa"), "prop");
});
