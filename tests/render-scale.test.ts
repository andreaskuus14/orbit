import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PX, MIN_DPR, newScale, renderDpr, scaleFloor, stepScale, type ScaleState } from "../src/lib/render-scale-pure.ts";

const run = (s: ScaleState, fps: number, worst: number, secs: number, floor?: number) => {
  for (let t = 0; t < secs; t += 0.5) s = stepScale(s, fps, 0.5, worst, floor);
  return s;
};

test("full scale keeps the old pixel ratio range [1, max]", () => {
  assert.equal(renderDpr(1901, 1000, 1.25, 1.75, 1), 1.25);
  assert.equal(renderDpr(800, 600, 0.8, 1.75, 1), 1); // zoomed out: still at least 1, as dpr={[1, max]} did
  assert.equal(renderDpr(800, 600, 2, 1.75, 1), 1.75);
});

test("the pixel cap holds on huge windows (a 4K screen at 150 %: 2560 x 1440 CSS px)", () => {
  const d = renderDpr(2560, 1440, 1.5, 1.75, 1);
  assert.ok(2560 * 1440 * d * d <= MAX_PX * 1.01);
  assert.ok(d < 1.5);
  assert.equal(renderDpr(6000, 3000, 1, 1.75, 1), MIN_DPR); // the floor wins over the cap
});

test("the scale lowers the ratio, never below MIN_DPR (or the screen's own)", () => {
  assert.equal(renderDpr(1901, 1000, 1.25, 1.75, 0.9), 1.13);
  assert.equal(renderDpr(1901, 1000, 1.25, 1.75, 0.1), MIN_DPR);
  assert.equal(renderDpr(1901, 1000, 1, 1, 0.1), MIN_DPR);
  assert.ok(Math.abs(scaleFloor(1.25, 1.75) * 1.25 - MIN_DPR) < 1e-9);
  assert.equal(scaleFloor(0.5, 1.75), MIN_DPR);
});

test("garbage in: a sane ratio out", () => {
  for (const v of [NaN, Infinity, -1, 0]) assert.ok(Number.isFinite(renderDpr(v, v, v, v, v)));
});

test("steps down after 1.5 s of slow frames (owner's PC: p50 20.8 ms, p95 27.7 ms)", () => {
  let s = newScale(1);
  s = run(s, 48, 28, 1);
  assert.equal(s.scale, 1);
  s = run(s, 48, 28, 0.5);
  assert.equal(s.scale, 0.9);
});

test("a single hitch does not lower the resolution", () => {
  let s = newScale(1);
  for (let i = 0; i < 20; i++) { s = run(s, 120, 8, 1); s = stepScale(s, 110, 0.5, 60); }
  assert.equal(s.scale, 1);
});

test("steady vsync at 60 holds; clear headroom steps back up after 6 s", () => {
  let s: ScaleState = { scale: 0.81, low: 0, high: 0 };
  s = run(s, 60, 17.2, 30);
  assert.equal(s.scale, 0.81);
  s = run(s, 110, 10, 6);
  assert.equal(s.scale, 0.9);
});

test("stays within [floor, 1]", () => {
  assert.equal(run(newScale(1), 20, 50, 60, 0.68).scale, 0.68);
  assert.equal(run(newScale(1), 144, 7, 60).scale, 1);
});

test("a saved scale starts one step higher; nonsense starts at full", () => {
  assert.equal(newScale(0.81).scale, 0.9);
  assert.equal(newScale(1).scale, 1);
  for (const v of [NaN, 0, -3]) assert.equal(newScale(v).scale, 1);
});

test("no evidence from hidden tabs or stalls", () => {
  const s = newScale(1);
  assert.equal(stepScale(s, 10, 5, 5000), s);
  assert.equal(stepScale(s, NaN, 0.5, 20), s);
});
