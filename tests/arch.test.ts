import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, boq, bulkTips, costLines, parseOps, parseSay, starterScene, STARTER_PRICES } from "../src/lib/arch-pure.ts";

let n = 0;
const id = () => `n${++n}`;

test("parseOps keeps valid ops, drops junk and out-of-range values", () => {
  const ops = parseOps('Sure! {"ops":[{"op":"scale","id":"p3","h":1.5},{"op":"add","kind":"wall","w":4,"d":4,"h":2.8},{"op":"add","kind":"pool","w":1,"d":1,"h":1},{"op":"plot","ground":"lava","trees":3},{"op":"set","id":"p1","w":9999}],"say":"Done"}');
  assert.equal(ops.length, 4);
  assert.deepEqual(ops[0], { op: "scale", id: "p3", w: undefined, d: undefined, h: 1.5 });
  assert.equal((ops[2] as { ground?: string }).ground, undefined);
  assert.equal((ops[3] as { w?: number }).w, undefined);
  assert.deepEqual(parseOps("no json here"), []);
  assert.equal(parseSay('{"ops":[],"say":"Made the walls \\"taller\\""}'), 'Made the walls "taller"');
});

test("taller walls push the roof up; a new part stacks on what is below", () => {
  const s = starterScene();
  const { scene, moved } = applyOps(s, [{ op: "scale", id: "p3", h: 1.5 }], id);
  const roof = scene.parts.find((p) => p.id === "p4")!;
  assert.equal(roof.y, 4.4); // walls 2.8 → 4.2 from y 0.2
  assert.deepEqual(moved, ["p4"]);
  assert.equal(scene.parts.find((p) => p.id === "p1")!.y, -0.8); // below: untouched
  const added = applyOps(scene, [{ op: "add", kind: "slab", w: 10, d: 8, h: 0.2 }], id).scene.parts.at(-1)!;
  assert.equal(added.y, 4.4); // under the roof, which moves up
  assert.equal(applyOps(s, [{ op: "add", kind: "foundation", w: 2, d: 2, h: 1, x: 50 }], id).scene.parts.at(-1)!.y, -1);
});

test("a new floor goes under the roof and lifts it; foundations grow down; things on moved parts move too", () => {
  const s = starterScene();
  const r = applyOps(s, [{ op: "add", kind: "slab", w: 10, d: 8, h: 0.2 }, { op: "add", kind: "wall", w: 10, d: 8, h: 2.8 }], id);
  const [slab, wall] = r.scene.parts.slice(-2), roof = r.scene.parts.find((p) => p.id === "p4")!;
  assert.equal(slab.y, 3); assert.equal(wall.y, 3.2); assert.equal(roof.y, 6);
  const f = applyOps(s, [{ op: "set", id: "p1", h: 1.2 }], id).scene.parts.find((p) => p.id === "p1")!;
  assert.equal(f.y, -1.2);
  const chimney = { id: "c", kind: "wall" as const, name: "chimney", x: 5.3, y: 5, z: 0, w: 0.4, d: 0.4, h: 1 };
  const m = applyOps({ ...s, parts: [...s.parts, chimney] }, [{ op: "scale", id: "p3", h: 1.5 }], id);
  assert.equal(m.scene.parts.find((p) => p.id === "c")!.y, 6.4);
  assert.equal(applyOps(s, [{ op: "scale", id: "p3", w: 10 }, { op: "scale", id: "p3", w: 10 }], id).scene.parts.find((p) => p.id === "p3")!.w, 100);
});

test("boq, cost and bulk tips come from geometry", () => {
  const q = boq(starterScene().parts);
  assert.equal(q.concreteM3, 29.6); // strip 34 m × 0.5 × 0.8 + slab 10×8×0.2
  assert.equal(q.rebarT, 2.96);
  assert.equal(boq([{ id: "w", kind: "wall", name: "", x: 0, y: 0, z: 0, w: 5, d: 0.3, h: 2 }]).blocks, Math.ceil(10 / 0.12)); // straight wall: 5 m × 2 m
  assert.ok(q.blocks > 0 && q.roofM2 > 0);
  const c = costLines(q, STARTER_PRICES);
  assert.equal(c.total, c.lines.reduce((s, l) => s + l.total, 0));
  const tips = bulkTips({ concreteM3: 13.5, rebarT: 0.5, blocks: 0, wallM3: 0, roofM2: 0 });
  assert.ok(tips.some((t) => t.includes("15 m³")) && tips.some((t) => t.includes("spare")) && tips.some((t) => t.includes("Rebar")));
  assert.deepEqual(bulkTips({ concreteM3: 0, rebarT: 0, blocks: 0, wallM3: 0, roofM2: 0 }), []);
});
