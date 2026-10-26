import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP, pushSnapshot, readSnapshots, shadowOf } from "../src/lib/arch-time-pure.ts";
import { starterScene } from "../src/lib/arch-pure.ts";
import { sunPosition } from "../src/lib/sun-pure.ts";

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

test("reference solar position: NREL SPA example (Golden CO, 2003-10-17 12:30:30 MST)", () => {
  // Reda & Andreas 2004, table A5.1: topocentric zenith 50.11162°, azimuth 194.34024°. sun-pure is geometric (no refraction,
  // ~0.017° at this height and 820 mbar) and NOAA's series is good to ~0.01° here, so allow 0.03°.
  const p = sunPosition(39.742476, -105.1786, new Date("2003-10-17T19:30:30Z"));
  near(p.azimuthDeg, 194.34024, 0.03);
  near(p.elevationDeg, 90 - 50.11162 - 0.017, 0.03);
});

test("shadowOf: length h/tan(el), points away from the sun, none at night", () => {
  const s = shadowOf({ azimuthDeg: 180, elevationDeg: 45 }, 5)!; // noon sun in the south → shadow 5 m north (−z)
  near(s.length, 5, 1e-9); near(s.dx, 0, 1e-9); near(s.dz, -5, 1e-9); assert.equal(s.towardDeg, 0);
  const w = shadowOf({ azimuthDeg: 90, elevationDeg: 30 }, 3)!; // morning sun in the east → shadow west (−x)
  near(w.length, 3 * Math.sqrt(3), 1e-9); near(w.dx, -w.length, 1e-9); assert.equal(w.towardDeg, 270);
  assert.equal(shadowOf({ azimuthDeg: 200, elevationDeg: -2 }, 5), null);
  assert.equal(shadowOf({ azimuthDeg: 200, elevationDeg: 0.01 }, 5, 120)!.length, 120); // grazing sun capped
});

test("pushSnapshot: skips an unchanged scene, keeps the last N, rejects non-scenes", () => {
  const a = starterScene(), b = { ...a, plot: { ...a.plot, trees: 3 } }, t = new Date("2026-10-26T10:00:00Z");
  let h = pushSnapshot([], a, t)!;
  assert.equal(h.length, 1);
  assert.equal(pushSnapshot(h, structuredClone(a), t), h);
  h = pushSnapshot(h, b, t)!;
  assert.deepEqual(h.map((x) => x.scene.plot.trees), [8, 3]);
  assert.equal(pushSnapshot(h, { parts: "x" }, t), null);
  for (let i = 0; i < KEEP + 5; i++) h = pushSnapshot(h, { ...a, plot: { ...a.plot, trees: i } }, t)!;
  assert.equal(h.length, KEEP);
  assert.equal(h.at(-1)!.scene.plot.trees, KEEP + 4);
});

test("readSnapshots: drops bad entries from the history file", () => {
  const ok = { at: "2026-10-26T10:00:00.000Z", scene: starterScene() };
  assert.deepEqual(readSnapshots([ok, null, { at: "nope", scene: ok.scene }, { at: ok.at, scene: { plot: {}, parts: "no" } }]), [ok]);
  assert.deepEqual(readSnapshots({ not: "a list" }), []);
});
