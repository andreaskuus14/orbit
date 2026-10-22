import { test } from "node:test";
import assert from "node:assert/strict";
import { ambient, ease, type AmbientInput } from "../src/lib/ambient-pure.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const day: AmbientInput = { focusRunning: false, automationFailing: false, pulseFailed: false, stopAll: false, hour: 12 };
const close = (a: number, b: number, epsilon = 1e-12) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test("normal is neutral, focus requests non-LIFE dimming, night is warm, and alert is red", () => {
  assert.deepEqual(ambient(day, NOW), { mode: "normal", dim: 0, tint: "#ffffff", vignette: 0, bloomScale: 1 });
  assert.equal(ambient({ ...day, focusRunning: true }, NOW).dim, 0.7);
  const night = ambient({ ...day, hour: 23 }, NOW);
  assert.equal(night.bloomScale, 0.7);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [nr, ng, nb] = rgb(night.tint);
  assert.ok(nr > ng && ng > nb, "night tint is warm");
  const alert = ambient({ ...day, pulseFailed: true }, NOW);
  assert.equal(alert.vignette, 0.35);
  const [r, g, b] = rgb(alert.tint);
  assert.ok(r > g && r > b, "alert tint is red");
});

test("night starts at 23:00 and ends at 06:00, including the midnight boundary", () => {
  for (let hour = 0; hour < 24; hour++) {
    assert.equal(ambient({ ...day, hour }, NOW).mode, [23, 0, 1, 2, 3, 4, 5].includes(hour) ? "night" : "normal", `local hour ${hour}`);
  }
});

test("all flag combinations at every hour obey alert > focus > night > normal", () => {
  for (let bits = 0; bits < 16; bits++) for (let hour = 0; hour < 24; hour++) {
    const state = { focusRunning: !!(bits & 1), automationFailing: !!(bits & 2), pulseFailed: !!(bits & 4), stopAll: !!(bits & 8), hour };
    const expected = bits & 14 ? "alert" : bits & 1 ? "focus" : hour < 6 || hour === 23 ? "night" : "normal";
    const result = ambient(state, NOW);
    assert.equal(result.mode, expected, JSON.stringify(state));
    assert.ok(result.dim >= 0 && result.dim <= 1);
    assert.ok(result.vignette >= 0 && result.vignette <= 1);
    assert.ok(result.bloomScale >= 0 && result.bloomScale <= 1.5);
    assert.match(result.tint, /^#[0-9a-f]{6}$/i);
  }
});

test("state changes immediately choose the new target, including clearing an alert", () => {
  const state = { ...day, focusRunning: true, pulseFailed: true, hour: 23 };
  assert.equal(ambient(state, NOW).mode, "alert");
  state.pulseFailed = false;
  assert.equal(ambient(state, NOW).mode, "focus");
  state.focusRunning = false;
  assert.equal(ambient(state, NOW).mode, "night");
  state.hour = 6;
  assert.equal(ambient(state, NOW).mode, "normal");
});

test("the supplied local hour is authoritative and no input or shared preset is mutated", () => {
  const state = Object.freeze({ ...day, hour: 23 });
  assert.deepEqual(ambient(state, 0), ambient(state, NOW));
  const first = ambient(state, NOW);
  first.dim = 1; first.tint = "#000000";
  assert.equal(ambient(state, NOW).dim, 0);
  assert.equal(ambient(state, NOW).tint, "#ffd6a3");
  assert.equal(state.hour, 23);
});

test("ease starts smoothly, moves monotonically in either direction, and never overshoots", () => {
  for (const [start, target] of [[0, 1], [1, 0], [-4, 7], [7, -4], [0.7, 0.7]]) {
    let value = start;
    for (let frame = 0; frame < 600; frame++) {
      const next = ease(value, target, 1 / 60);
      assert.ok(next >= Math.min(value, target) && next <= Math.max(value, target));
      assert.ok(Math.abs(target - next) <= Math.abs(target - value));
      value = next;
    }
    close(value, target, 1e-10);
  }
  assert.ok(ease(0, 1, 1 / 60) > 0 && ease(0, 1, 1 / 60) < 0.1);
});

test("equal elapsed time at 30/60/144/240 fps produces the same blend", () => {
  const end = (fps: number) => {
    let value = 0;
    for (let frame = 0; frame < fps; frame++) value = ease(value, 1, 1 / fps);
    return value;
  };
  for (const fps of [30, 60, 144, 240]) {
    close(end(fps), end(60));
    assert.ok(end(fps) > 0.95 && end(fps) < 0.96);
  }
  close(ease(ease(0, 1, 0.05), 1, 0.05), ease(0, 1, 0.1));
});

test("zero, negative and invalid time deltas hold the previous value; long pauses cannot snap", () => {
  for (const dt of [0, -0.1, -10, NaN, Infinity, -Infinity]) assert.equal(ease(0.3, 1, dt), 0.3);
  assert.equal(ease(0.3, 1, 60), ease(0.3, 1, 0.1));
  assert.ok(ease(0, 1, 60) < 0.3);
  assert.ok(ease(1, 0, 60) > 0.7);
  assert.equal(ease(0.7, 0.7, 60), 0.7);
});

test("retargeting a partial blend reverses smoothly without snapping", () => {
  const partial = ease(0, 0.7, 0.1);
  const reversed = ease(partial, 0, 1 / 60);
  assert.ok(reversed > 0 && reversed < partial);
  const colorWeight = ease(0, 1, 1 / 60);
  assert.ok(colorWeight > 0 && colorWeight < 1);
});
