import { test } from "node:test";
import assert from "node:assert/strict";
import { DIVE_CROSS, DIVE_FADE, DIVE_SECS, diveFov, diveRadii, NEAR_RADII, stepWindow, windowCrop, windowTarget, type Crop, type WindowState } from "../src/lib/window-pure.ts";

test("window: dive beats hover beats a near planet; far planets are no window", () => {
  assert.equal(windowTarget("studio", "memory", "arch", 2), "studio");
  assert.equal(windowTarget(null, "memory", "arch", 2), "memory");
  assert.equal(windowTarget(null, null, "arch", 2), "arch");
  assert.equal(windowTarget(null, null, "arch", NEAR_RADII + 1), null);
  assert.equal(windowTarget(null, null, "arch", NaN), null);
});

test("window: blends in over ~300 ms, and only one portal is live at a time", () => {
  const s: WindowState = { id: null, k: 0 };
  for (let i = 0; i < 18; i++) stepWindow(s, "memory", 1 / 60); // 300 ms
  assert.equal(s.id, "memory");
  assert.ok(s.k > 0.9 && s.k <= 1);
  stepWindow(s, "studio", 1 / 60);
  assert.equal(s.id, "memory", "the old window fades out first");
  let n = 0;
  while (s.id === "memory" && n++ < 200) stepWindow(s, "studio", 1 / 60);
  assert.ok(n < 60, "within a second");
  assert.ok([null, "studio"].includes(s.id as string | null));
  stepWindow(s, "studio", 1 / 60);
  assert.equal(s.id, "studio");
  stepWindow(s, "arch", 1 / 60, 0.1, true); // a dive switches at once
  assert.equal(s.id, "arch");
  for (let i = 0; i < 200; i++) stepWindow(s, null, 1 / 60);
  assert.deepEqual(s, { id: null, k: 0 });
  stepWindow(s, "memory", NaN);
  assert.ok(Number.isFinite(s.k));
});

test("window: the crop box hugs the planet, stays on screen and goes full screen up close", () => {
  const c: Crop = { x: 0, y: 0, w: 0, h: 0, ok: false };
  windowCrop(0.2, -0.1, 20, 1, 1.2, 2.1, c);
  assert.ok(c.ok && c.w < 0.15 && c.h < 0.2 && Math.abs(c.x - 0.2) < 1e-9);
  assert.ok(c.h > 2.1 / 20, "covers the silhouette");
  windowCrop(0.98, 0, 20, 1, 1.2, 2.1, c); // at the right edge: clipped to the screen
  assert.ok(c.ok && c.x + c.w <= 1 + 1e-9);
  windowCrop(0, 0, 1.1, 1, 1.2, 2.1, c);
  assert.deepEqual(c, { x: 0, y: 0, w: 1, h: 1, ok: true });
  windowCrop(0, 0, -20, 1, 1.2, 2.1, c);
  assert.equal(c.ok, false, "behind the camera");
  windowCrop(5, 0, 20, 1, 1.2, 2.1, c);
  assert.equal(c.ok, false);
  windowCrop(NaN, 0, 20, 1, 1.2, 2.1, c);
  assert.equal(c.ok, false);
});

test("dive: crosses the surface at DIVE_CROSS, speeds up on the way, settles inside; entry stays <= 1.2 s", () => {
  assert.ok(DIVE_CROSS + DIVE_FADE <= 1.2 && DIVE_SECS <= 1.2);
  for (const r0 of [3, 8, 120]) {
    assert.ok(Math.abs(diveRadii(0, r0) - r0) < 1e-9);
    assert.ok(Math.abs(diveRadii(DIVE_CROSS, r0) - 1) < 1e-9);
    let prev = r0;
    for (let t = 0.01; t <= 1.5; t += 0.01) {
      const r = diveRadii(t, r0);
      assert.ok(Number.isFinite(r) && r <= prev + 1e-9 && r > 0.3, "monotonic, never through the centre");
      prev = r;
    }
    assert.ok(diveRadii(DIVE_CROSS - 0.01, r0) > 1 && diveRadii(DIVE_CROSS + 0.01, r0) < 1);
  }
  assert.ok(Math.log(diveRadii(0.05, 8) / diveRadii(0.1, 8)) < Math.log(diveRadii(0.6, 8) / diveRadii(0.65, 8)), "speeds up");
  assert.ok(Number.isFinite(diveRadii(NaN, NaN)));
});

test("dive: reverse dolly zoom widens the FOV toward the surface, never past 90", () => {
  assert.equal(diveFov(0, 50), 50);
  assert.ok(diveFov(DIVE_CROSS / 2, 50) > 50);
  assert.equal(diveFov(DIVE_CROSS, 50), 82);
  assert.equal(diveFov(5, 38), 82);
  assert.equal(diveFov(1, 120), 90);
  assert.ok(Number.isFinite(diveFov(NaN, NaN)));
});
