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
  assert.match(py, /sky_type = 'NISHITA'/);
  assert.match(py, new RegExp(`samples = ${QUALITY.detail.samples}`));
  assert.match(py, /use_denoising = True/);
  assert.match(py, /view_transform = 'AgX'/);
  assert.match(py, /BEVEL/);
  assert.ok(!/NaN|undefined/.test(py));
});
