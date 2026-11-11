import { test } from "node:test";
import assert from "node:assert/strict";
import { concepts, face, parseBrief } from "../src/lib/arch-concepts-pure.ts";
import { MAX } from "../src/lib/arch-pure.ts";

test("brief: junk is clamped to safe defaults", () => {
  assert.deepEqual(parseBrief({ area: 9999, bedrooms: -3, sauna: "yes", view: "up" }), { area: 300, bedrooms: 1, sauna: false, view: "s" });
});

test("three different concepts, each a valid scene that matches the brief", () => {
  const cs = concepts({ area: 120, bedrooms: 2, sauna: true, view: "s" });
  assert.deepEqual(cs.map((c) => c.name), ["Long bar", "L-shape", "Compact square"]);
  for (const c of cs) {
    const ps = c.scene.parts, ids = new Set(ps.map((p) => p.id));
    assert.equal(ids.size, ps.length, `${c.name}: unique ids`);
    assert.ok(ps.length <= MAX.parts);
    assert.ok(Math.abs(c.area - 120) / 120 < 0.25, `${c.name}: ${c.area} m² near 120`);
    assert.deepEqual(c.rooms.filter((r) => r.startsWith("Bedroom")).length, 2);
    assert.ok(c.rooms.includes("Sauna"));
    assert.ok(ps.some((p) => p.kind === "door"), `${c.name}: has a front door`);
    assert.ok(ps.filter((p) => p.kind === "window").length >= 2, `${c.name}: daylight`);
    for (const p of ps) { assert.ok([p.x, p.z, p.w, p.d, p.h].every(Number.isFinite)); if (p.host) assert.ok(ids.has(p.host), `${p.id} host`); }
    for (const p of ps) assert.ok(Math.abs(p.x) + p.w / 2 <= c.scene.plot.w / 2 && Math.abs(p.z) + p.d / 2 <= c.scene.plot.d / 2, `${c.name}: ${p.id} on the plot`);
  }
  assert.ok(cs[0].tradeoff && cs[1].idea, "each states its idea and trade-off");
});

test("living glazing faces the view", () => {
  for (const view of ["n", "e", "s", "w"] as const) {
    const win = concepts({ area: 100, bedrooms: 1, view })[0].scene.parts.find((p) => p.name === "Window Living")!;
    assert.equal(win.face, view);
  }
});

test("rotation keeps hosts and turns faces", () => {
  const sc = { plot: { w: 30, d: 20, ground: "grass" as const, trees: 0 }, parts: [{ id: "w", kind: "window" as const, name: "w", x: 2, y: 1, z: 3, w: 1.2, d: 0.08, h: 1, host: "x", face: "s" as const }] };
  const r = face(sc, "w").parts[0];
  assert.deepEqual([r.x, r.z, r.w, r.d, r.face], [-3, 2, 0.08, 1.2, "w"]);
  assert.deepEqual(face(sc, "w").plot.w, 20);
});
