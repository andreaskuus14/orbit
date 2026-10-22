import { test } from "node:test";
import assert from "node:assert/strict";
import { isCapped, stepQuality, parseQualityMode, worldQuality, leanWorldQuality, QUALITY, type QualityState } from "../src/lib/quality-pure.ts";

test("world fallback lowers Auto DPR, MSAA and bloom, while manual presets always win", () => {
  for (const mode of ["auto", "low", "high"] as const) {
    const preset = worldQuality(mode);
    assert.deepEqual(leanWorldQuality(mode, false), { dpr: preset.dpr, msaa: preset.msaa, bloomScale: preset.bloom });
    const fallback = leanWorldQuality(mode, true);
    if (mode === "auto") assert.deepEqual(fallback, { dpr: 1, msaa: 0, bloomScale: 0 });
    else assert.deepEqual(fallback, leanWorldQuality(mode, false));
  }
});

const run = (s: QualityState, fps: number, secs: number, max: 0 | 1 | 2 | 3 = 2, worst = 0) => {
  for (let t = 0; t < secs; t += 0.5) s = stepQuality(s, fps, 0.5, max, worst);
  return s;
};
const start: QualityState = { level: 2, low: 0, high: 0 };

test("world quality follows the shared presets, defaulting to medium for auto", () => {
  assert.equal(worldQuality("low"), QUALITY[0]);
  assert.equal(worldQuality("auto"), QUALITY[1]);
  assert.equal(worldQuality("high"), QUALITY[2]);
  assert.equal(worldQuality(), QUALITY[1]);
  assert.ok(worldQuality("low").dpr < worldQuality("auto").dpr);
  assert.ok(worldQuality("auto").dpr < worldQuality("high").dpr);
});

test("steps down only after 3 s below 40 fps", () => {
  assert.equal(run(start, 25, 2.5).level, 2);
  assert.equal(run(start, 25, 3).level, 1);
  assert.equal(run(start, 25, 6).level, 0);
  assert.equal(run(start, 25, 60).level, 0); // floor
});

test("a good sample resets the slow streak", () => {
  let s = run(start, 25, 2.5);
  s = stepQuality(s, 50, 0.5);
  assert.equal(run(s, 25, 2.5).level, 2);
});

test("steps up only after 10 s above 55 fps, capped by max", () => {
  const low: QualityState = { level: 0, low: 0, high: 0 };
  assert.equal(run(low, 60, 9.5).level, 0);
  assert.equal(run(low, 60, 10).level, 1);
  assert.equal(run(low, 60, 40, 1).level, 1);
  assert.equal(run(start, 60, 30, 1).level, 1); // reduced motion clamps a high start down
});

test("after a step down it never climbs back to the level it fell from", () => {
  let s = run(start, 25, 3);
  assert.equal(s.level, 1);
  s = run(s, 60, 60);
  assert.equal(s.level, 1); // vsync 60 fps no longer see-saws 2 → 1 → 2
  s = run(s, 25, 3);
  s = run(s, 60, 15);
  assert.equal(s.level, 0);
});

test("ignores hidden-tab gaps and bad numbers", () => {
  assert.deepEqual(stepQuality(start, 5, 30), start);
  assert.deepEqual(stepQuality(start, NaN, 0.5), start);
});

test("parses the stored mode", () => {
  assert.equal(parseQualityMode("low"), "low");
  assert.equal(parseQualityMode(null), "auto");
  assert.equal(parseQualityMode("ultra"), "auto");
});

test("a steady 30 fps browser cap is healthy, slow or erratic frames still step down", () => {
  assert.ok(isCapped(30.3, 35) && isCapped(29.4) && !isCapped(30, 55) && !isCapped(33));
  assert.equal(run(start, 30.3, 60, 2, 35).level, 2); // capped: never steps down
  assert.equal(run({ level: 0, low: 0, high: 0 }, 30.3, 25, 3, 35).level, 2); // and climbs back
  assert.equal(run(start, 30, 3, 2, 60).level, 1); // 30 fps with 60 ms spikes is strain
  assert.equal(run(start, 26, 3, 2, 39).level, 1); // below the cap is strain
});
