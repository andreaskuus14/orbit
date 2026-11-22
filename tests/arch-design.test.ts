import { test } from "node:test";
import assert from "node:assert/strict";
import { designHouse, facadeAreas, readHints, storeys, trueSide, DESIGN } from "../src/lib/arch-design-pure.ts";
import { fitOpenings, roofForm, styleOf, type Part, type Scene } from "../src/lib/arch-pure.ts";
import { generatePlans, parseBrief, planScene, STARTER_BRIEF } from "../src/lib/arch-plan-pure.ts";
import { planToScene, samplePlan } from "../src/lib/arch-floorplan-pure.ts";
import { concepts } from "../src/lib/arch-concepts-pure.ts";
import { houseMesh } from "../src/lib/arch-mesh-pure.ts";

const box = (parts: Part[]): Scene => ({ plot: { w: 30, d: 25, ground: "grass", trees: 4 }, parts: fitOpenings(parts) });
const base = (): Part[] => [
  { id: "f", kind: "foundation", name: "Footing", x: 0, y: -0.8, z: 0, w: 10, d: 8, h: 0.8 },
  { id: "s1", kind: "slab", name: "Slab", x: 0, y: 0, z: 0, w: 10, d: 8, h: 0.2 },
  { id: "w1", kind: "wall", name: "Walls 1", x: 0, y: 0.2, z: 0, w: 10, d: 8, h: 2.8 },
  { id: "r", kind: "roof", name: "Roof", x: 0, y: 3, z: 0, w: 11, d: 9, h: 0.3 },
];
const twoStorey = () => planScene(parseBrief(STARTER_BRIEF.rooms, STARTER_BRIEF.adj, { w: 30, d: 25 }, 2), generatePlans(parseBrief(STARTER_BRIEF.rooms, STARTER_BRIEF.adj, { w: 30, d: 25 }, 2), 1)[0]);

test("words → hints, English and Estonian; nothing said → no hint (the Nordic default decides)", () => {
  assert.deepEqual(readHints("modern funkis house with a flat roof"), { roof: "flat", roofMat: "membrane" });
  assert.equal(readHints("puidust maja viilkatusega").facade, "timber");
  assert.equal(readHints("puidust maja viilkatusega").roof, "gable");
  assert.equal(readHints("brick house, hipped roof, clay tiles").roof, "hip");
  assert.equal(readHints("brick house, hipped roof, clay tiles").roofMat, "tile");
  assert.deepEqual(readHints("three bedrooms and a sauna"), {});
});

test("Nordic default: a 35° gable over the long side with 0.5 m eaves and 0.3 m gables; plaster walls, timber gables, steel roof", () => {
  const d = designHouse(box(base())), r = d.scene.parts.find((p) => p.kind === "roof")!;
  assert.equal(roofForm(r), "gable"); assert.equal(r.pitch, 35); assert.equal(r.ridge, "x");
  assert.equal(r.w, 10.6); assert.equal(r.d, 9);
  assert.ok(Math.abs(r.h - Math.tan((35 * Math.PI) / 180) * 4.5) < 0.01, "height follows the pitch");
  assert.deepEqual(styleOf(d.scene), { facade: "plaster", roofMat: "metal", gable: "timber" });
  assert.ok(d.notes.some((n) => /gable/.test(n)) && d.notes.some((n) => /Materials/.test(n)));
});

test("the brief wins: flat roof gets a parapet roof and membrane; timber house has no separate gable cladding", () => {
  const flat = designHouse(box(base()), { words: "flat roof" });
  const r = flat.scene.parts.find((p) => p.kind === "roof")!;
  assert.equal(roofForm(r), "flat"); assert.equal(styleOf(flat.scene).roofMat, "membrane");
  const t = designHouse(box(base()), { words: "a timber house" });
  assert.deepEqual(styleOf(t.scene), { facade: "timber", roofMat: "metal" });
});

test("storey height: a 2.4 m wall becomes 2.8 m (3.0 m floor to floor) and the roof moves up with it", () => {
  const p = base(); p[2].h = 2.4; p[3].y = 2.6;
  const d = designHouse(box(p)), w = d.scene.parts.find((x) => x.id === "w1")!, r = d.scene.parts.find((x) => x.kind === "roof")!;
  assert.equal(w.h, DESIGN.wallH); assert.equal(r.y, 3);
  assert.ok(d.notes.some((n) => /floor to floor/.test(n)));
});

test("a floating roof is set down onto the walls", () => {
  const p = base(); p[3].y = 3.6;
  assert.equal(designHouse(box(p)).scene.parts.find((x) => x.kind === "roof")!.y, 3);
});

test("massing: an upper storey wider than the one below is pulled back over its walls", () => {
  const p = [...base().slice(0, 3), { id: "s2", kind: "slab" as const, name: "Slab 2", x: 1, y: 3, z: 0, w: 12, d: 8, h: 0.2 }, { id: "w2", kind: "wall" as const, name: "Walls 2", x: 1, y: 3.2, z: 0, w: 12, d: 8, h: 2.8 }, { ...base()[3], y: 6 }];
  const d = designHouse(box(p)), w2 = d.scene.parts.find((x) => x.id === "w2")!;
  assert.ok(w2.x + w2.w / 2 <= 5 + 1e-9 && w2.x - w2.w / 2 >= -5 - 1e-9);
  assert.equal(storeys(d.scene.parts).length, 2);
});

test("windows: module widths, one head height per storey, upper windows stacked over lower ones", () => {
  const p = base(), wins: Part[] = [
    { id: "a", kind: "window", name: "W", host: "w1", face: "s", off: -2, sill: 0.9, x: 0, y: 0, z: 0, w: 1.23, d: 0, h: 1.2 },
    { id: "b", kind: "window", name: "W", host: "w1", face: "s", off: 2, sill: 0.9, x: 0, y: 0, z: 0, w: 1.2, d: 0, h: 1.2 },
    { id: "c", kind: "window", name: "W", host: "w1", face: "s", off: 0, sill: 0.9, x: 0, y: 0, z: 0, w: 1.2, d: 0, h: 1.0 },
  ];
  const d = designHouse(box([...p, ...wins])), get = (id: string) => d.scene.parts.find((x) => x.id === id)!;
  assert.ok(Math.abs(get("a").w * 10 - Math.round(get("a").w * 10)) < 1e-9, "0.1 m module");
  assert.equal(r(get("c").sill! + get("c").h), r(get("a").sill! + get("a").h), "heads line up");
});
const r = (n: number) => Math.round(n * 100) / 100;

test("window-to-wall ratio: an all-glass north side is cut back; orientation follows the site's north", () => {
  const p = base(), big: Part = { id: "g", kind: "window", name: "W", host: "w1", face: "n", off: 0, sill: 0.1, x: 0, y: 0, z: 0, w: 8, d: 0, h: 2.5 };
  const before = facadeAreas(fitOpenings([...p, big])).n, d = designHouse(box([...p, big]));
  const after = facadeAreas(d.scene.parts).n;
  assert.ok(before.glass / before.wall > DESIGN.wwr.n[1] && after.glass / after.wall <= DESIGN.wwr.n[1] + 0.05, `${after.glass / after.wall}`);
  assert.equal(trueSide("n", 180), "s"); assert.equal(trueSide("e", 90), "n");
});

test("entrance: the front door is made the main one (≥ 1.0 × 2.1 m) with a canopy and a landing", () => {
  const d0: Part = { id: "d", kind: "door", name: "Door", group: "exterior", host: "w1", face: "n", off: 0, x: 0, y: 0, z: 0, w: 0.8, d: 0, h: 2.0 };
  const d = designHouse(box([...base(), d0])), door = d.scene.parts.find((x) => x.id === "d")!;
  assert.ok(door.w >= 1 && door.h >= 2.1 && door.name === "Front door");
  const canopy = d.scene.parts.find((x) => /canopy/i.test(x.name))!, step = d.scene.parts.find((x) => /step/i.test(x.name))!;
  assert.ok(canopy.kind === "prop" && canopy.z < -4 && canopy.y > door.y + door.h, "canopy outside the north wall, over the door");
  assert.ok(step && step.y === 0);
  const again = designHouse(d.scene);
  assert.equal(again.scene.parts.filter((x) => /canopy/i.test(x.name)).length, 1, "running it twice adds nothing");
});

test("idempotent: a designed house passes its own check", () => {
  for (const s of [twoStorey(), planToScene(samplePlan()).scene, ...concepts({}).map((c) => c.scene)]) {
    const once = designHouse(s).scene, twice = designHouse(once);
    assert.equal(twice.notes.filter((n) => !/no windows|no front door|side door/.test(n)).length, 0, twice.notes.join(" | "));
  }
});

test("real generators: every house gets a pitched roof, finite geometry, and plain notes", () => {
  const cs = concepts({});
  const square = designHouse(cs[2].scene);
  assert.equal(square.scene.parts.filter((p) => p.kind === "roof").length, 1, "two roofs that make one block become one");
  for (const s of [twoStorey(), planToScene(samplePlan()).scene, ...cs.map((c) => c.scene)]) {
    const d = designHouse(s);
    assert.ok(d.scene.parts.filter((p) => p.kind === "roof").every((p) => roofForm(p) !== "flat"));
    const m = houseMesh(d.scene);
    assert.ok(m.tris > 300 && !m.groups.some((g) => g.pos.some((v) => !Number.isFinite(v))));
    assert.ok(d.notes.every((n) => n.length < 220 && !/undefined|NaN/.test(n)));
  }
});

test("the AI can change the roof form and the materials: parsed, checked, and kept through later edits", async () => {
  const { parseOps, applyOps, starterScene } = await import("../src/lib/arch-pure.ts");
  const ops = parseOps('{"ops":[{"op":"roof","id":"p4","form":"hip","pitch":30},{"op":"style","facade":"brick","roofMat":"gold"},{"op":"roof","id":"p4","form":"dome"}]}');
  assert.deepEqual(ops[0], { op: "roof", id: "p4", form: "hip", pitch: 30, ridge: undefined });
  assert.deepEqual(ops[1], { op: "style", facade: "brick", roofMat: undefined, gable: undefined });
  assert.equal((ops[2] as { form?: string }).form, undefined, "unknown form dropped");
  const s = applyOps(starterScene(), ops.slice(0, 2), () => "x").scene, r = s.parts.find((p) => p.id === "p4")!;
  assert.equal(r.roof, "hip"); assert.ok(Math.abs(r.h - Math.tan(Math.PI / 6) * 4.5) < 0.01, "rise follows the pitch over half the span");
  assert.equal(styleOf(s).facade, "brick"); assert.equal(styleOf(s).roofMat, "metal");
  const later = applyOps(s, [{ op: "scale", id: "p3", w: 1.1 }], () => "y").scene;
  assert.equal(later.style?.facade, "brick", "style survives other edits");
});
