import { test } from "node:test";
import assert from "node:assert/strict";
import { blenderScript, camera, partBox, sunVector, toBlender, QUALITY } from "../src/lib/arch-blender-pure.ts";
import { starterScene } from "../src/lib/arch-pure.ts";

const site = { lat: 59.437, lon: 24.7536 }; // Tallinn

test("axes: scene north (−Z) becomes Blender +Y, y up becomes z up", () => {
  assert.deepEqual(toBlender(1, 2, -3), [1, 3, 2]);
});

test("sun: due south at noon points to −Y and up; east is +X", () => {
  const s = sunVector(180, 30);
  assert.ok(Math.abs(s[0]) < 1e-9 && s[1] < 0 && s[2] > 0);
  assert.ok(sunVector(90, 0)[0] > 0.999);
});

test("openings take the host wall's thickness so the cut goes through", () => {
  const wall = { id: "w", kind: "wall", name: "w", x: 0, y: 0, z: 0, w: 8, d: 0.3, h: 3 } as const;
  const win = { id: "o", kind: "window", name: "o", x: 1, y: 1, z: 0.15, w: 1.2, d: 0, h: 1.4, host: "w", face: "s" } as const;
  assert.deepEqual(partBox(win, wall).s, [1.2, 0.32, 1.4]);
  assert.equal(partBox(win, wall).c[1], -0, "centred on the wall's thickness, not its face");
  assert.deepEqual(partBox({ ...win, face: "e" }, wall).s, [8.02, 1.2, 1.4]);
});

test("camera: level, at eye height, outside the model, with lens shift for straight verticals", () => {
  const c = camera(starterScene());
  assert.equal(c.loc[2], 1.6);
  assert.ok(Math.hypot(c.loc[0], c.loc[1]) > 6);
  assert.ok(c.shiftY > 0 && c.shiftY <= 0.5);
});

test("script: every part is built, real sun from site and date, detail quality settings", () => {
  const sc = starterScene(), py = blenderScript(sc, { site, date: new Date("2026-06-21T10:00:00Z"), quality: "detail" });
  for (const p of sc.parts.filter((p) => p.kind !== "window" && p.kind !== "door")) assert.ok(py.includes(JSON.stringify(p.name)), p.name);
  assert.match(py, /sky_type = 'MULTIPLE_SCATTERING'/);
  assert.match(py, new RegExp(`samples = ${QUALITY.detail.samples}`));
  assert.match(py, /use_denoising = True/);
  assert.match(py, /view_transform = 'AgX'/);
  assert.match(py, /BEVEL/);
  assert.ok(!/NaN|undefined/.test(py));
});

test("fly-through: starts outside at eye level, rises over the model with the roof off, ends standing inside", async () => {
  const { flyPath, blenderSequence } = await import("../src/lib/arch-blender-pure.ts");
  const sc = starterScene(), P = flyPath(sc, 48, { x: 0, z: 0 });
  assert.equal(P.length, 48);
  assert.ok(Math.abs(P[0].cam[2] - 1.6) < 1e-6 && Math.hypot(P[0].cam[0], P[0].cam[1]) > 10 && P[0].roof, "outside, eye level, roof on");
  const top = P.reduce((m, p) => (p.cam[2] > m.cam[2] ? p : m));
  assert.ok(!top.roof && top.cam[2] > 8, "highest point: roof lifted, looking down at the plan");
  const last = P.at(-1)!;
  assert.ok(Math.abs(last.cam[2] - 1.55) < 1e-6 && Math.abs(last.cam[0]) < 5 && Math.abs(last.cam[1]) < 4, "standing inside");
  const py = blenderSequence(sc, { site, date: new Date("2026-06-21T12:00:00Z"), quality: "preview" }, P);
  assert.match(py, /f%03d\.png/); assert.match(py, /hide_render = not roof/); assert.ok(!/true|false|NaN/.test(py.split("P = ")[1].split("\n")[0]));
});

test("asset library: props map to real CC0 models by name (coffee table before table); unknown props stay boxes", async () => {
  const { assetFor, libraryIds } = await import("../src/lib/arch-blender-pure.ts");
  assert.equal(assetFor("Sofa"), "proc:sofa");
  assert.equal(assetFor("Coffee table"), "modern_coffee_table_01");
  assert.equal(assetFor("Dining table"), "proc:table");
  assert.equal(assetFor("Armchair"), "mid_century_lounge_chair");
  assert.ok(!libraryIds().some((id) => id.startsWith("proc:")), "modelled pieces need no download");
  assert.equal(assetFor("Rug"), null);
  assert.ok(libraryIds().includes("fir_sapling_medium") && new Set(libraryIds()).size === libraryIds().length);
});

test("dressing: with an asset folder, known props become library models (boxes hidden), textures and sky load, lights stay off camera", async () => {
  const { blenderScript } = await import("../src/lib/arch-blender-pure.ts");
  const sc = { plot: { w: 30, d: 25, ground: "grass" as const, trees: 3 }, parts: [...starterScene().parts, { id: "s1", kind: "prop" as const, name: "Sofa", x: 0, y: 0.2, z: 1, w: 2.2, d: 0.9, h: 0.8 }, { id: "r1", kind: "prop" as const, name: "Rug", x: 0, y: 0.2, z: 0, w: 2, d: 2, h: 0.02 }] };
  const py = blenderScript(sc, { site, date: new Date("2026-09-10T16:00:00Z"), quality: "preview", assets: "/lib" });
  assert.match(py, /obj\["s1"\]\.hide_render = True; modern\("sofa", \(0, -1, 0\.2\), 0, 2\.2, 0\.9, 0\.8, False\)/);
  assert.doesNotMatch(py, /obj\["r1"\]\.hide_render/, "the rug has no model, so its box stays");
  assert.equal((py.match(/place\('fir_sapling_medium'/g) ?? []).length, 3);
  assert.match(py, /sky\.hdr/); assert.match(py, /visible_camera = False/);
  assert.ok(py.trimEnd().endsWith("bpy.ops.render.render(write_still=True)"), "render stays the last line");
  const plain = blenderScript(sc, { site, date: new Date("2026-09-10T16:00:00Z"), quality: "preview" });
  assert.doesNotMatch(plain, /sky\.hdr|place\(/, "no folder: unchanged");
});

test("facade: every opening gets an aluminium frame on the wall's outer face; a wide south glazing gets a deck", async () => {
  const { facadeLines } = await import("../src/lib/arch-blender-pure.ts");
  const wall = { id: "ws", kind: "wall" as const, name: "South wall", x: 0, y: 0.2, z: 4.35, w: 14, d: 0.3, h: 3 };
  const win = { id: "g1", kind: "window" as const, name: "Glazing", x: -3, y: 0.45, z: 4.5, w: 5.2, d: 0.2, h: 2.3, host: "ws", face: "s" as const };
  const L = facadeLines({ plot: { w: 40, d: 30, ground: "grass", trees: 0 }, parts: [wall, win] });
  assert.equal(L.filter((l) => l.includes("'frame'")).length, 4, "two jambs, head and sill");
  assert.ok(L.some((l) => l.includes("'deck'")));
  assert.ok(L.filter((l) => l.includes("'frame'")).every((l) => l.includes("-4.5")), "frames sit on the outer face (scene z 4.5 → Blender y -4.5)");
});

test("with the library the simple cone trees are left out (real firs only)", async () => {
  const { blenderScript } = await import("../src/lib/arch-blender-pure.ts");
  const sc = { ...starterScene(), plot: { ...starterScene().plot, trees: 4 } }, o = { site, date: new Date("2026-09-10T16:00:00Z"), quality: "preview" as const };
  assert.match(blenderScript(sc, o), /primitive_cone_add/);
  const lib = blenderScript(sc, { ...o, assets: "/lib" });
  assert.doesNotMatch(lib, /primitive_cone_add/); assert.match(lib, /fir_sapling_medium/);
});

test("film: the Kivi House fixture makes a dressed, resumable 150-frame sequence script", async () => {
  const { blenderSequence, flyPath } = await import("../src/lib/arch-blender-pure.ts");
  const { readFileSync } = await import("node:fs");
  const sc = JSON.parse(readFileSync(new URL("./fixtures/arch-kivi-house.json", import.meta.url), "utf8"));
  const py = blenderSequence(sc, { site, date: new Date("2026-09-10T16:40:00Z"), quality: "detail", size: [1920, 1080], assets: "/lib" }, flyPath(sc, 150));
  assert.equal(JSON.parse(py.split("\nP = ")[1].split("\n")[0].split("  #")[0]).length, 150);
  assert.match(py, /if os\.path\.exists\(f\) and os\.path\.getsize\(f\) > 0: continue/);
  assert.match(py, /modern\("sofa"/); assert.match(py, /resolution_x = 1920/); assert.match(py, /samples = 1024/);
});
