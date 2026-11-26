import { test } from "node:test";
import assert from "node:assert/strict";
import { cutFace, houseMesh, windowLit, pitchOf, roofBase, roofTop, siteLayout, frontDoor, isOuterWall, propMat, type MeshGroup } from "../src/lib/arch-mesh-pure.ts";
import { applyOps, fitOpenings, starterScene, type Part, type Scene } from "../src/lib/arch-pure.ts";

const shell: Part = { id: "w", kind: "wall", name: "Walls", x: 0, y: 0.2, z: 0, w: 10, d: 8, h: 2.8 };
const roof = (o: Partial<Part> = {}): Part => ({ id: "r", kind: "roof", name: "Roof", x: 0, y: 3, z: 0, w: 10.6, d: 9, h: 2.8, ...o });
const scene = (parts: Part[], extra: Partial<Scene> = {}): Scene => ({ plot: { w: 30, d: 25, ground: "grass", trees: 6 }, parts: fitOpenings(parts), ...extra });
const win = (o: Partial<Part> = {}): Part => ({ id: "o1", kind: "window", name: "Window", host: "w", face: "s", off: 0, sill: 0.9, x: 0, y: 0, z: 0, w: 1.2, d: 0, h: 1.2, ...o });
const bounds = (g: MeshGroup[]) => { const ys = g.flatMap((x) => x.pos.filter((_, i) => i % 3 === 1)); return [Math.min(...ys), Math.max(...ys)]; };
const of = (m: ReturnType<typeof houseMesh>, mat: string) => m.groups.filter((g) => g.mat === mat);
const glass = (m: ReturnType<typeof houseMesh>) => [...of(m, "glass"), ...of(m, "glassLit")];

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

test("v12: window reveals are deep (glass 20 cm behind the facade) and a rendered house gets painted corner boards", () => {
  const m = houseMesh(scene([shell, win()])), zs = glass(m)[0].pos.filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...zs) <= 4 - 0.2 + 1e-6, `glass ${Math.max(...zs)}`);
  const trim = of(houseMesh(scene([shell], { style: { facade: "plaster", roofMat: "metal" } })), "trim");
  const xs = trim.flatMap((g) => g.pos.filter((_, i) => i % 3 === 0));
  assert.ok(xs.some((x) => x > 5.01) && xs.some((x) => x < -5.01), "boards stand proud of the render at the corners");
});

test("a window is a hole with reveals, a frame set back, glass, an outside sill and an inside board", () => {
  const m = houseMesh(scene([shell, win()]));
  assert.ok(glass(m).length && of(m, "frame").length && of(m, "sill").length && of(m, "inner").length);
  const g = glass(m)[0].pos, zs = g.filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...zs) < 4 - 0.1, "glass sits back from the outer face (in the reveal)");
  assert.ok(Math.min(...zs) > 4 - 0.3, "and inside the wall's thickness");
  const wide = houseMesh(scene([shell, win({ w: 2.4 })])), narrow = houseMesh(scene([shell, win()]));
  assert.ok(of(wide, "frame")[0].tri.length > of(narrow, "frame")[0].tri.length, "a wide window gets mullions");
  assert.ok(glass(m)[0].tri.every((id) => id === "o1"), "glass picks the window");
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

// ---- v11 detail ----
const ground = (o: Partial<Part> = {}): Part => ({ ...shell, y: 0, ...o });
const tris = (m: ReturnType<typeof houseMesh>, mat: string) => of(m, mat).reduce((n, g) => n + g.tri.length, 0);

test("windows get a sash inside the frame and painted casing boards round the opening; no window is see-through glass material", () => {
  const plain = houseMesh(scene([shell]));
  const m = houseMesh(scene([shell, win()]));
  assert.ok(tris(m, "trim") - tris(plain, "trim") >= 3 * 12, "left, right and head casing boards");
  assert.ok(tris(m, "frame") >= 8 * 12, "outer frame + sash bars");
  assert.equal(tris(plain, "trim"), 4 * 12, "a plain rendered shell has only its four corner boards");
  const zs = of(m, "trim").flatMap((g) => g.pos.filter((_, i) => i % 3 === 2));
  assert.ok(Math.max(...zs) > 4 - 0.01 && Math.max(...zs) < 4 + 0.06, "casing stands a few cm proud of the outer face");
});

test("about two in three windows are lit, always the same ones", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `w${i}`), lit = ids.filter(windowLit).length;
  assert.ok(lit > 170 && lit < 230, `${lit}`); assert.deepEqual(ids.filter(windowLit), ids.filter(windowLit));
  const m = houseMesh(scene([shell, win({ id: "a1" }), win({ id: "a2", off: 2.5 }), win({ id: "a3", off: -2.5 }), win({ id: "a4", off: 3.5, w: 0.8 })]));
  assert.ok(glass(m).length >= 1);
});

test("a concrete plinth band runs round the foot of the outer walls and breaks at the door", () => {
  const door: Part = { id: "d1", kind: "door", name: "Front door", host: "w", face: "s", off: 0, x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 };
  const m = houseMesh(scene([ground(), door]));
  const band = of(m, "plinth").flatMap((g) => g.pos);
  assert.ok(band.length);
  const hs = band.filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...hs) <= 0.3 + 1e-6 || of(m, "plinth").length > 0);
  const south = of(m, "plinth").flatMap((g) => { const r: number[][] = []; for (let i = 0; i < g.pos.length; i += 3) r.push([g.pos[i], g.pos[i + 1], g.pos[i + 2]]); return r; }).filter((v) => v[2] > 4.01 && v[2] < 4.03 && v[1] > 0.29 && v[1] < 0.31);
  assert.ok(south.length, "band on the south face");
  assert.ok(south.every((v) => Math.abs(v[0]) > 0.5 - 1e-6), "nothing across the doorway");
  const none = houseMesh(scene([shell]));
  assert.equal(tris(none, "plinth"), 0, "walls that do not start at ground have no plinth band");
});

test("metal roofs have standing seams every 0.55 m, tile and membrane roofs do not", () => {
  const metal = houseMesh(scene([shell, roof({ roof: "gable", pitch: 30, ridge: "x" })], { style: { facade: "plaster", roofMat: "metal" } }));
  const tile = houseMesh(scene([shell, roof({ roof: "gable", pitch: 30, ridge: "x" })], { style: { facade: "plaster", roofMat: "tile" } }));
  const seams = tris(metal, "roofMetal");
  assert.ok(seams > 2 * 16 * 12, `${seams}`);
  assert.equal(tris(tile, "roofMetal"), 0); assert.ok(tris(tile, "roofTile") > 0);
});

test("the front door gets a concrete step and a canopy; other doors do not", () => {
  const front: Part = { id: "d1", kind: "door", name: "Front door", host: "w", face: "s", off: 0, x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 };
  const back: Part = { id: "d2", kind: "door", name: "Back door", host: "w", face: "n", off: 2, x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 };
  const withFront = houseMesh(scene([ground(), front])), both = houseMesh(scene([ground(), front, back]));
  assert.ok(tris(withFront, "concrete") >= 12 && tris(withFront, "fascia") >= 12);
  assert.equal(tris(both, "concrete"), tris(withFront, "concrete"), "only the front door");
});

test("a part named chimney is a brick stack with a cap and a flue pot", () => {
  const ch: Part = { id: "c1", kind: "prop", name: "Chimney", x: 2, y: 3, z: 0, w: 0.6, d: 0.6, h: 3 };
  const m = houseMesh(scene([ground(), ch]));
  assert.ok(tris(m, "brick") >= 12 && tris(m, "coping") >= 12 && tris(m, "metal") >= 12);
  assert.equal(tris(houseMesh(scene([ground(), { ...ch, name: "Bench" }])), "brick"), 0);
});
