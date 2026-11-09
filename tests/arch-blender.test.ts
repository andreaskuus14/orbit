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
