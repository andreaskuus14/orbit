import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, boq, costLines, starterScene, STARTER_PRICES } from "../src/lib/arch-pure.ts";
import { addVariant, compare, diffParts, readVariants } from "../src/lib/arch-variants-pure.ts";
import { buildExports, checkCsv, checkIfc, checkJson, parseCsv, parseStep } from "../src/lib/arch-export-pure.ts";
import { toIfc } from "../src/lib/arch-ifc-pure.ts";
import { openingIssue, parseDim, snapCentre, snapGrid } from "../src/lib/arch-snap-pure.ts";
import { cleanDaylight, daylightPlan, studyMonth, summarize } from "../src/lib/arch-daylight-pure.ts";

let n = 0;
const id = () => `t${n++}`;
const base = starterScene();
const wall = base.parts.find((p) => p.kind === "wall" && p.w > 1)!;
const bigger = applyOps(base, [{ op: "set", id: wall.id, w: wall.w + 2 }, { op: "add", kind: "window", host: wall.id, face: "s", w: 1.2 }], id).scene;
const shared = { prices: STARTER_PRICES, site: { lat: 59.44, lon: 24.75 }, north: 0, energy: null };

test("variants: save, read back, diff and attribute differences", () => {
  const list = addVariant([], "  ", 7, base, "v1");
  assert.equal(list[0].name, "Variant r7");
  assert.notEqual(list[0].scene, base); // a copy: editing the model later does not change the variant
  assert.deepEqual(readVariants([...list, { id: 1 }, null]), list);
  const ch = diffParts(base.parts, bigger.parts);
  assert.ok(ch.some((c) => c.type === "added") && ch.some((c) => c.id === wall.id && c.fields.includes("w")));
  const r = compare(base, bigger, shared);
  assert.equal(r.total.cost, r.b.cost - r.a.cost);
  assert.ok(r.total.cost > 0);
  const sum = r.changes.reduce((t, c) => t + c.delta.cost, 0);
  assert.equal(sum + r.rest.cost, r.total.cost); // per-change effects + interaction add up to the total
  assert.equal(r.a.kWh, null); // energy off
  const unknown = compare(base, bigger, { ...shared, prices: STARTER_PRICES.map((p) => (p.key === "windows" ? { ...p, eur: null } : p)) });
  assert.equal(unknown.b.unknown - unknown.a.unknown, unknown.total.unknown);
  assert.ok(unknown.b.unknown >= 1);
});

test("variants: energy uses the same inputs on both sides", () => {
  const r = compare(base, base, { ...shared, energy: { uWall: 0.17, uWindow: 0.8, uRoof: 0.12, uFloor: 0.15, ach: 0.5, inside: 21, design: -22, degreeDays: 4200, stepMin: 60, year: 2025 } });
  assert.equal(r.total.kWh, 0);
  assert.deepEqual(r.changes, []);
});

test("exports: every format round-trips and is ready", () => {
  for (const s of [base, bigger]) {
    const c = costLines(boq(s.parts), STARTER_PRICES, s.parts), xs = buildExports(s, c, { lat: 59.437, lon: 24.7536 }, new Date(0));
    for (const x of xs) assert.ok(x.ok, `${x.format}: ${JSON.stringify(x.checks.filter((k) => !k.ok))}`);
  }
});

test("exports: a file that differs from the model fails validation", () => {
  const c = costLines(boq(bigger.parts), STARTER_PRICES, bigger.parts);
  const ifc = toIfc(bigger, { site: { lat: 59.4, lon: 24.7 } });
  const fail = (cs: { ok: boolean; name: string }[], name: string) => assert.equal(cs.find((k) => k.name === name)?.ok, false, name);
  fail(checkIfc(ifc.replace(".METRE.", ".FOOT."), bigger), "units: metres (scale 1)");
  fail(checkIfc(ifc.replace("IFCSIUNIT(*,.LENGTHUNIT.,$,", "IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,"), bigger), "units: metres (scale 1)");
  fail(checkIfc(ifc, bigger, { site: { lat: 10, lon: 24.7 } }), "metadata: project, site lat/lon");
  const moved = applyOps(bigger, [{ op: "set", id: wall.id, x: wall.x + 1 }], id).scene; // model moved after export
  fail(checkIfc(ifc, moved), "orientation + position");
  fail(checkIfc(ifc, applyOps(bigger, [{ op: "set", id: wall.id, h: wall.h + 1 }], id).scene), "dimensions (m)");
  assert.equal(checkIfc("garbage", bigger)[0].ok, false);
  assert.equal(checkJson("{", bigger)[0].ok, false);
  fail(checkJson(JSON.stringify(base), bigger), "same model");
  const csv = parseCsv("a,\"b,\"\"c\"\"\"\n1,2\n");
  assert.deepEqual(csv, [["a", 'b,"c"'], ["1", "2"]]);
  fail(checkCsv("Item\n", c), "rows");
  assert.equal(parseStep(ifc).ents.size > 10, true);
});

test("snap: typed units, grid, edges, opening inside its wall", () => {
  assert.equal(parseDim("240 cm"), 2.4);
  assert.equal(parseDim("-1,5"), -1.5);
  assert.equal(parseDim("2400mm"), 2.4);
  assert.equal(parseDim("abc"), null);
  assert.equal(snapGrid(1.234, 0.1), 1.2);
  assert.equal(snapGrid(1.234, 0), 1.234);
  const other = { ...wall, id: "o", name: "Other", x: 10, w: 4 }; // edges at 8 and 12
  const me = { ...wall, id: "m", w: 2 };
  assert.deepEqual(snapCentre(me, "x", 13.1, [other], 0.5), { v: 13, to: "Other" }); // my left edge on its right edge
  assert.deepEqual(snapCentre(me, "x", 20.3, [other], 0.5), { v: 20.5, to: null });
  const win = bigger.parts.find((p) => p.kind === "window")!;
  assert.equal(openingIssue(win, wall && bigger.parts.find((p) => p.id === wall.id)), null);
  assert.match(openingIssue({ ...win, w: 99 }, bigger.parts.find((p) => p.id === wall.id))!, /wider/);
  assert.match(openingIssue({ ...win, h: 99 }, bigger.parts.find((p) => p.id === wall.id))!, /taller/);
  assert.equal(openingIssue(win, undefined), "no host wall");
});

test("daylight inputs: clamped, and step changes sampling but not the hour totals' units", () => {
  assert.deepEqual(cleanDaylight({ day: 40, stepMin: 1, year: "x", dfDiv: 6 }), { day: 28, stepMin: 15, year: 2025, dfDiv: 6 });
  const plan = daylightPlan(bigger.parts), site = { lat: 59.44, lon: 24.75 };
  const h1 = Array.from({ length: 12 }, (_, m) => studyMonth(plan, site, m));
  const h30 = Array.from({ length: 12 }, (_, m) => studyMonth(plan, site, m, 2025, 21, 30));
  assert.equal(h30[0].up.length, 48);
  const [a] = summarize(plan, h1), [b] = summarize(plan, h30, 30), [c] = summarize(plan, h1, 60, 10);
  assert.ok(Math.abs(a.junHours - b.junHours) <= 1.5);
  assert.ok(Math.abs(c.df - a.df / 2) <= 0.1); // ÷10 is half of ÷5
});
