import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, starterScene } from "../src/lib/arch-pure.ts";
import { generatePlans, parseBrief, planScene, STARTER_BRIEF } from "../src/lib/arch-plan-pure.ts";
import { compressGuid, expandGuid, ifcGuid, real, str, toIfc } from "../src/lib/arch-ifc-pure.ts";

/** Minimal STEP reader: DATA lines → id → { type, args } with top-level args split (strings, nested lists respected). */
function parseStep(text: string) {
  const data = text.slice(text.indexOf("DATA;") + 5, text.lastIndexOf("ENDSEC;"));
  const ents = new Map<number, { type: string; args: string[] }>();
  for (const line of data.split("\n").filter((l) => l.trim())) {
    const m = line.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/);
    assert.ok(m, `bad line ${line}`);
    const args: string[] = []; let depth = 0, cur = "", q = false;
    for (let i = 0; i < m[3].length; i++) {
      const c = m[3][i];
      if (q) { cur += c; if (c === "'") { if (m[3][i + 1] === "'") { cur += "'"; i++; } else q = false; } continue; }
      if (c === "'") q = true;
      if (c === "(") depth++; if (c === ")") depth--;
      if (c === "," && depth === 0) { args.push(cur); cur = ""; } else cur += c;
    }
    assert.equal(q, false); assert.equal(depth, 0);
    args.push(cur);
    assert.ok(!ents.has(Number(m[1])), `duplicate #${m[1]}`);
    ents.set(Number(m[1]), { type: m[2], args });
  }
  return ents;
}
const ARITY: Record<string, number> = { IFCPROJECT: 9, IFCSITE: 14, IFCBUILDING: 12, IFCBUILDINGSTOREY: 10, IFCWALL: 9, IFCSLAB: 9, IFCFOOTING: 9, IFCROOF: 9, IFCSTAIR: 9,
  IFCOPENINGELEMENT: 9, IFCWINDOW: 13, IFCDOOR: 13, IFCRELVOIDSELEMENT: 6, IFCRELFILLSELEMENT: 6, IFCRELAGGREGATES: 6, IFCRELCONTAINEDINSPATIALSTRUCTURE: 6,
  IFCSIUNIT: 4, IFCUNITASSIGNMENT: 1, IFCEXTRUDEDAREASOLID: 4, IFCRECTANGLEPROFILEDEF: 5, IFCLOCALPLACEMENT: 2, IFCAXIS2PLACEMENT3D: 3, IFCAXIS2PLACEMENT2D: 2,
  IFCCARTESIANPOINT: 1, IFCDIRECTION: 1, IFCSHAPEREPRESENTATION: 4, IFCPRODUCTDEFINITIONSHAPE: 3, IFCGEOMETRICREPRESENTATIONCONTEXT: 6,
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT: 10, IFCPOLYLINE: 1, IFCARBITRARYCLOSEDPROFILEDEF: 3 };
const ROOTED = ["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCWALL", "IFCSLAB", "IFCFOOTING", "IFCROOF", "IFCSTAIR", "IFCOPENINGELEMENT", "IFCWINDOW", "IFCDOOR", "IFCREL"];
const count = (e: ReturnType<typeof parseStep>, t: string) => [...e.values()].filter((x) => x.type === t).length;

function check(text: string) {
  assert.match(text, /^ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION\(.*\);\nFILE_NAME\(.*\);\nFILE_SCHEMA\(\('IFC4'\)\);\nENDSEC;\nDATA;\n/);
  assert.match(text, /ENDSEC;\nEND-ISO-10303-21;\n$/);
  const e = parseStep(text), guids = new Set<string>();
  for (const [id, { type, args }] of e) {
    assert.ok(type in ARITY, `unexpected ${type}`);
    assert.equal(args.length, ARITY[type], `#${id} ${type} has ${args.length} attributes`);
    for (const r of args.join(",").matchAll(/#(\d+)/g)) assert.ok(e.has(Number(r[1])) && Number(r[1]) < id, `#${id} → missing/forward #${r[1]}`);
    if (ROOTED.some((t) => type.startsWith(t))) {
      const g = args[0].slice(1, -1);
      assert.match(g, /^[0-3][0-9A-Za-z_$]{21}$/, `GUID ${g}`);
      assert.ok(!guids.has(g), `duplicate GUID ${g}`); guids.add(g);
    }
  }
  for (const [, { args }] of [...e].filter(([, x]) => x.type === "IFCCARTESIANPOINT" || x.type === "IFCDIRECTION"))
    for (const n of args[0].slice(1, -1).split(",")) assert.match(n, /^-?\d+\.\d*$/, `real ${n}`);
  return e;
}

test("GUIDs: 22 chars, IFC alphabet, round-trip, stable per key", () => {
  const bytes = Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 255);
  const g = compressGuid(bytes);
  assert.equal(g.length, 22); assert.deepEqual(expandGuid(g), bytes);
  assert.equal(compressGuid(new Array(16).fill(255)), "3" + "$".repeat(21));
  assert.equal(compressGuid(new Array(16).fill(0)), "0".repeat(22));
  assert.equal(ifcGuid("a"), ifcGuid("a")); assert.notEqual(ifcGuid("a"), ifcGuid("b"));
});

test("STEP literals: reals always have a point, strings escape quotes and non-ASCII", () => {
  assert.equal(real(3), "3."); assert.equal(real(-0), "0."); assert.equal(real(2.8), "2.8"); assert.equal(real(1e-9), "0."); assert.equal(real(-1.25), "-1.25");
  assert.equal(str("it's"), "'it''s'"); assert.equal(str("Köök"), "'K\\X2\\00F600F6\\X0\\k'"); assert.equal(str("a\\b"), "'a\\\\b'");
  assert.equal(str("1→2"), "'1\\X2\\2192\\X0\\2'");
});

test("starter scene: one storey, metres, shell as four walls, a window voids its wall", () => {
  let n = 0;
  const scene = applyOps(starterScene(), [{ op: "add", kind: "window", host: "p3", face: "s", w: 1.2 }, { op: "add", kind: "door", host: "p3", face: "e", w: 0.9 }], () => `x${++n}`).scene;
  const text = toIfc(scene, { time: new Date("2026-10-28T12:00:00Z"), site: { lat: 59.437, lon: 24.754 } });
  const e = check(text);
  assert.equal(count(e, "IFCPROJECT"), 1); assert.equal(count(e, "IFCSITE"), 1); assert.equal(count(e, "IFCBUILDING"), 1); assert.equal(count(e, "IFCBUILDINGSTOREY"), 1);
  assert.equal(count(e, "IFCWALL"), 4); assert.equal(count(e, "IFCSLAB"), 1); assert.equal(count(e, "IFCFOOTING"), 1); assert.equal(count(e, "IFCROOF"), 1);
  assert.equal(count(e, "IFCWINDOW"), 1); assert.equal(count(e, "IFCDOOR"), 1); assert.equal(count(e, "IFCOPENINGELEMENT"), 2);
  assert.equal(count(e, "IFCRELVOIDSELEMENT"), 2); assert.equal(count(e, "IFCRELFILLSELEMENT"), 2);
  assert.match(text, /IFCSIUNIT\(\*,\.LENGTHUNIT\.,\$,\.METRE\.\)/);
  assert.match(text, /IFCSITE\(.*\(59,26,13,200000\),\(24,45,14,400000\)/); // 59.437° = 59° 26′ 13.2″
  // the south window's opening voids the south wall
  const wall = [...e].find(([, x]) => x.type === "IFCWALL" && x.args[2].endsWith("south'"))!;
  const voids = [...e.values()].filter((x) => x.type === "IFCRELVOIDSELEMENT").map((x) => x.args[4]);
  assert.ok(voids.includes(`#${wall[0]}`));
  // windows and doors sit in the storey; openings don't
  const contained = [...e.values()].find((x) => x.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE")!.args[4];
  assert.equal(contained.split(",").length, 4 + 1 + 1 + 1 + 2);
  assert.equal(toIfc(scene, { time: new Date(0) }).split("\n").slice(6).join(), toIfc(scene, { time: new Date(1e12) }).split("\n").slice(6).join()); // same model → same file body
});

test("generated two-floor plan: two storeys, stair, slab pieces around the stairwell, every window hosted", () => {
  const b = parseBrief(STARTER_BRIEF.rooms, STARTER_BRIEF.adj, { w: 30, d: 25 }, 2);
  const scene = planScene(b, generatePlans(b)[0]);
  const e = check(toIfc(scene, { name: "Plan 1" }));
  assert.equal(count(e, "IFCBUILDINGSTOREY"), 2);
  assert.equal(count(e, "IFCSTAIR"), 1);
  assert.ok(count(e, "IFCSLAB") >= 2);
  const wins = scene.parts.filter((p) => p.kind === "window").length, doors = scene.parts.filter((p) => p.kind === "door").length;
  assert.equal(count(e, "IFCWINDOW"), wins); assert.equal(count(e, "IFCDOOR"), doors);
  assert.equal(count(e, "IFCOPENINGELEMENT"), wins + doors);
  const elevs = [...e.values()].filter((x) => x.type === "IFCBUILDINGSTOREY").map((x) => Number(x.args[9]));
  assert.deepEqual(elevs, [0, 3]);
});

test("true north: the context's TrueNorth points at the site's north bearing; none when north is model +Y", () => {
  const scene = starterScene();
  const ctxOf = (text: string) => { const e = parseStep(text); const ctx = [...e.values()].find((x) => x.type === "IFCGEOMETRICREPRESENTATIONCONTEXT")!; return { e, tn: ctx.args[5] }; };
  for (const north of [30, 90, 200, -45]) {
    const { e, tn } = ctxOf(toIfc(scene, { site: { lat: 59.437, lon: 24.745, north } }));
    const d = e.get(Number(tn.slice(1)))!;
    assert.equal(d.type, "IFCDIRECTION");
    const [x, y] = d.args[0].replace(/[()]/g, "").split(",").map(Number);
    const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360; // clockwise from +Y, the reading #451's import uses
    assert.ok(Math.abs(bearing - ((north + 360) % 360)) < 1e-4, `north ${north} → ${bearing}`);
  }
  assert.equal(ctxOf(toIfc(scene, { site: { lat: 59.437, lon: 24.745 } })).tn, "$");
  assert.equal(ctxOf(toIfc(scene, { site: { lat: 59.437, lon: 24.745, north: 0 } })).tn, "$");
});
