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
  assert.equal(added.y, 6.4); // on top of the roof (4.4 + 2)
  assert.equal(applyOps(s, [{ op: "add", kind: "foundation", w: 2, d: 2, h: 1, x: 50 }], id).scene.parts.at(-1)!.y, -1);
});

test("boq, cost and bulk tips come from geometry", () => {
  const q = boq(starterScene().parts);
  assert.equal(q.concreteM3, 80); // 10×8×0.8 + 10×8×0.2
  assert.equal(q.rebarT, 8);
  assert.ok(q.blocks > 0 && q.roofM2 > 0);
  const c = costLines(q, STARTER_PRICES);
  assert.equal(c.total, c.lines.reduce((s, l) => s + l.total, 0));
  const tips = bulkTips({ concreteM3: 13.5, rebarT: 0.5, blocks: 0, wallM3: 0, roofM2: 0 });
  assert.ok(tips.some((t) => t.includes("15 m³")) && tips.some((t) => t.includes("spare")) && tips.some((t) => t.includes("Rebar")));
  assert.deepEqual(bulkTips({ concreteM3: 0, rebarT: 0, blocks: 0, wallM3: 0, roofM2: 0 }), []);
});
