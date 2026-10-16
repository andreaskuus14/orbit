import { test } from "node:test";
import assert from "node:assert/strict";
import { lifeFraction, lifeRingGlow, lifeRingStep, LIFE_RING_MAX_GLOW } from "../src/lib/galaxy-life-pure.ts";

test("lifeFraction clamps bad input", () => {
  assert.equal(lifeFraction(0, 0), 0);
  assert.equal(lifeFraction(3, 0), 0);
  assert.equal(lifeFraction(NaN, 4), 0);
  assert.equal(lifeFraction(2, NaN), 0);
  assert.equal(lifeFraction(2, Infinity), 0);
  assert.equal(lifeFraction(-1, 4), 0);
  assert.equal(lifeFraction(9, 4), 1);
  assert.equal(lifeFraction(1, 4), 0.25);
});

test("lifeRingStep snaps to twelfths, never closes early", () => {
  assert.equal(lifeRingStep(0, 5), 0);
  assert.equal(lifeRingStep(1, 100), 1 / 12); // any progress is visible
  assert.equal(lifeRingStep(99, 100), 11 / 12); // not closed until all done
  assert.equal(lifeRingStep(5, 5), 1);
  assert.equal(lifeRingStep(7, 5), 1);
  assert.equal(lifeRingStep(1, 2), 6 / 12);
  assert.equal(lifeRingStep(NaN, NaN), 0);
});

test("lifeRingGlow stays within bounds and only pulses when full and moving", () => {
  for (let t = 0; t < 20; t += 0.37) {
    const g = lifeRingGlow(1, t, false);
    assert.ok(g >= 0 && g <= LIFE_RING_MAX_GLOW);
  }
  assert.equal(lifeRingGlow(1, 1, true), lifeRingGlow(1, 5, true)); // static when still
  assert.equal(lifeRingGlow(0.5, 1, false), lifeRingGlow(0.5, 5, false)); // no pulse when partial
  assert.ok(Number.isFinite(lifeRingGlow(1, NaN, false)));
});
