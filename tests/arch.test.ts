import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, boq, boqCsv, bulkTips, costLines, parseOps, parseSay, starterScene, STARTER_PRICES, type Op } from "../src/lib/arch-pure.ts";

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
  const tips = bulkTips({ concreteM3: 13.5, rebarT: 0.5, blocks: 0, wallM3: 0, roofM2: 0, windows: 0, doors: 0 });
  assert.ok(tips.some((t) => t.includes("15 m³")) && tips.some((t) => t.includes("spare")) && tips.some((t) => t.includes("Rebar")));
  assert.deepEqual(bulkTips({ concreteM3: 0, rebarT: 0, blocks: 0, wallM3: 0, roofM2: 0, windows: 0, doors: 0 }), []);
});

const win = (o: { w?: number; off?: number; sill?: number; host?: string } = {}): Op => ({ op: "add", kind: "window", host: "p3", face: "s", w: 1.2, ...o });
const last = (s: ReturnType<typeof starterScene>) => s.parts.at(-1)!;

test("parseOps reads windows and doors; they need a host and a face", () => {
  const ops = parseOps('{"ops":[{"op":"add","kind":"window","host":"p3","face":"s","w":1.2},{"op":"add","kind":"door","host":"p3","face":"up","w":1},{"op":"add","kind":"door","w":1,"d":1,"h":2},{"op":"set","id":"x","off":1.5,"sill":1,"face":"e"}]}');
  assert.deepEqual(ops[0], { op: "add", kind: "window", name: undefined, host: "p3", face: "s", w: 1.2, h: undefined, off: undefined, sill: undefined });
  assert.equal(ops.length, 2);
  assert.equal((ops[1] as { off?: number }).off, 1.5);
});

test("an opening sits on its wall face and is clamped inside it", () => {
  const s = starterScene();
  const w = last(applyOps(s, [win()], id).scene); // shell 10 × 8 at y 0.2, south face z = +4
  assert.deepEqual([w.x, w.y, w.z, w.w, w.h, w.sill], [0, 1.1, 4, 1.2, 1.2, 0.9]);
  const big = last(applyOps(s, [win({ w: 20, off: 100 })], id).scene);
  assert.deepEqual([big.w, big.off], [9.4, 0]); // 10 m face minus 0.3 m at each corner
  const edge = last(applyOps(s, [win({ w: 2, off: 10, sill: 5 })], id).scene);
  assert.deepEqual([edge.off, edge.x, edge.sill, edge.h], [3.7, 3.7, 2.4, 0.3]); // stays under the wall top minus lintel
  const door = last(applyOps(s, [{ op: "add", kind: "door", host: "p3", face: "e", w: 0.9, sill: 1 }], id).scene);
  assert.deepEqual([door.x, door.z, door.y, door.h], [5, 0, 0.2, 2.1]); // doors start at the floor
  assert.equal(applyOps(s, [win({ host: "p4" })], id).scene.parts.length, 4); // a roof can't host one
});

test("openings move, re-clamp and disappear with their wall", () => {
  const s = applyOps(starterScene(), [win({ w: 2, off: 3.7 })], id).scene, wid = last(s).id;
  const moved = applyOps(s, [{ op: "set", id: "p3", x: 3, z: 1 }], id).scene.parts.find((p) => p.id === wid)!;
  assert.deepEqual([moved.x, moved.z], [6.7, 5]);
  const shrunk = applyOps(s, [{ op: "scale", id: "p3", w: 0.5 }], id).scene.parts.find((p) => p.id === wid)!;
  assert.equal(shrunk.off, 1.2); // 5 m face: (4.4 - 2) / 2
  const r = applyOps(s, [{ op: "scale", id: "p3", h: 1.5 }], id).scene;
  assert.equal(r.parts.find((p) => p.id === "p4")!.y, 4.4); // roof still rides the wall, not the window
  assert.equal(applyOps(s, [{ op: "remove", id: "p3" }], id).scene.parts.some((p) => p.id === wid), false);
  const set = applyOps(s, [{ op: "set", id: wid, face: "w", off: 0, w: 1 }], id).scene.parts.find((p) => p.id === wid)!;
  assert.deepEqual([set.x, set.z, set.w], [-5, 0, 1]);
});

test("boq takes openings off the walls and counts them; interior walls stand on the floor", () => {
  const base = boq(starterScene().parts);
  const s = applyOps(starterScene(), [win(), { op: "add", kind: "door", host: "p3", face: "n", w: 0.9 }], id).scene, q = boq(s.parts);
  assert.equal(base.blocks, 812); // (36 - 1.2) m × 2.8 m / 0.12
  assert.equal(q.blocks, Math.ceil((97.44 - 1.44 - 1.89) / 0.12));
  assert.equal(q.wallM3, Math.round((base.wallM3 - (1.44 + 1.89) * 0.3) * 100) / 100);
  assert.deepEqual([q.windows, q.doors], [1, 1]);
  const c = costLines(q, STARTER_PRICES);
  assert.equal(c.lines.find((l) => l.key === "windows")!.total, 350);
  const csv = boqCsv(c).trim().split("\n");
  assert.equal(csv.length, c.lines.length + 2);
  assert.ok(csv[0].startsWith("Item,Qty") && csv.at(-1)!.includes(String(c.total)) && csv.some((l) => l.includes('"Window, PVC')));
  const inner = applyOps(starterScene(), [{ op: "add", kind: "wall", w: 9.4, d: 0.2, h: 2.8 }], id).scene;
  assert.equal(last(inner).y, 0.2);
  assert.equal(inner.parts.find((p) => p.id === "p4")!.y, 3); // the roof doesn't move
});
