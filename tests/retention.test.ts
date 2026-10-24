import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRetention, type RetentionPoint, type RetentionInput } from "../src/lib/retention-pure.ts";

const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const curve = (fn: (t: number) => number, n = 100): RetentionPoint[] => Array.from({ length: n + 1 }, (_, i) => ({ t: i / n, retained: fn(i / n) }));
const ramp = (t: number, start: number, end: number) => Math.max(0, Math.min(1, (t - start) / (end - start)));

test("hooks interpolate observed watch ratios at 3 and 30 seconds", () => {
  const r = analyzeRetention({ duration: 100, points: curve((t) => 1 - 0.5 * t) });
  near(r.hookHold.at3s!, 0.985); near(r.hookHold.at30s!, 0.85);
  assert.equal(r.relativeHook, null);
  assert.equal(r.drops.length, 1); near(r.drops[0].lostPct!, 50);
});

test("three crafted steep drops are ranked by loss and attached to the overlapping beat and words", () => {
  const points = curve((t) => 1 - 0.3 * ramp(t, 0.05, 0.1) - 0.2 * ramp(t, 0.4, 0.45) - 0.1 * ramp(t, 0.8, 0.85), 400);
  const r = analyzeRetention({ duration: 100, points, chapters: [{ start: 0, label: "Intro" }, { start: 20, label: "Build" }, { start: 70, label: "Reveal" }],
    transcript: [{ start: 4, end: 12, text: "Before the experiment, some context." }, { start: 39, end: 46, text: "Here is the setup." }] });
  assert.equal(r.drops.length, 3);
  for (const [i, expected] of [0.3, 0.2, 0.1].entries()) near(r.drops[i].change, expected, 0.01);
  near(r.drops[0].start, 5, 0.5); near(r.drops[0].end, 10, 0.5);
  near(r.drops[0].lostPercentagePoints!, 30, 1); near(r.drops[1].lostPct!, 0.2 / 0.7 * 100, 1);
  assert.equal(r.drops[0].beat?.label, "Intro"); assert.equal(r.drops[1].beat?.label, "Build");
  assert.equal(r.drops[0].transcript?.text, "Before the experiment, some context.");
  assert.match(r.rule, /^Test cutting the intro/);
  assert.equal(r.rule.match(/[.!?]/g)?.length, 1);
});

test("a smaller fast loss is found despite a slow background decline", () => {
  const r = analyzeRetention({ duration: 200, points: curve((t) => 1 - 0.15 * t - 0.2 * ramp(t, 0.5, 0.55), 400) });
  assert.ok(r.drops.length >= 1); near(r.drops[0].start, 100, 1); near(r.drops[0].end, 110, 1);
  assert.match(r.rule, /around 105 seconds/);
});

test("rewatch candidates retain values above 100 percent and need prominence on both sides", () => {
  const r = analyzeRetention({ duration: 100, points: curve((t) => 0.9 + 0.4 * Math.max(0, 1 - Math.abs(t - 0.5) / 0.07), 400) });
  assert.equal(r.rewatchSpikes.length, 1); near(r.rewatchSpikes[0].peak, 50, 0.5);
  assert.ok(r.rewatchSpikes[0].retained > 1.25); assert.ok(r.rewatchSpikes[0].prominence > 0.35);
  assert.equal(analyzeRetention({ duration: 100, points: curve((t) => 0.8 + t) }).rewatchSpikes.length, 0);
});

test("relative retention reports score changes, never viewer loss, hook hold or rewatches", () => {
  const r = analyzeRetention({ duration: 100, metric: "relativeRetentionPerformance", points: curve((t) => 0.8 - 0.3 * ramp(t, 0.1, 0.2)) });
  assert.deepEqual(r.hookHold, { at3s: null, at30s: null }); near(r.relativeHook!.at3s!, 0.8);
  assert.ok(r.drops.length); assert.equal(r.drops[0].lostPct, null); assert.equal(r.drops[0].lostPercentagePoints, null);
  near(r.drops[0].change, 0.3, 0.01); assert.deepEqual(r.rewatchSpikes, []);
});

test("short videos do not invent a 30 second hold, or a 3 second hold before they reach it", () => {
  const r = analyzeRetention({ duration: 10, points: curve((t) => 1 - t / 2) });
  near(r.hookHold.at3s!, 0.85); assert.equal(r.hookHold.at30s, null);
  const short = analyzeRetention({ duration: 2, points: curve(() => 1.2) });
  assert.deepEqual(short.hookHold, { at3s: null, at30s: null }); assert.deepEqual(short.drops, []);
});

test("missing, singleton, invalid and widely separated samples give conservative finite results", () => {
  for (const duration of [0, -1, NaN, Infinity, 100]) {
    const r = analyzeRetention({ duration }); assert.equal(r.drops.length, 0); assert.match(r.rule, /Collect/);
  }
  const r = analyzeRetention({ duration: 100, points: [{ t: 0, retained: 1 }, { t: 1, retained: 0 }, { t: NaN, retained: 0.5 }, { t: 0.3, retained: Infinity }, { t: -1, retained: 1 }, { t: 0.2, retained: -1 }] });
  assert.equal(r.samples, 2); assert.deepEqual(r.hookHold, { at3s: null, at30s: null }); assert.deepEqual(r.drops, []);
  assert.deepEqual(analyzeRetention({ duration: 100, points: [{ t: 0.03, retained: 0.7 }] }).hookHold, { at3s: 0.7, at30s: null });
});

test("analysis never bridges a large missing interval or extrapolates missing endpoints", () => {
  const points = [...curve(() => 1).filter((p) => p.t <= 0.1), ...curve(() => 0.2).filter((p) => p.t >= 0.7)];
  const r = analyzeRetention({ duration: 100, points });
  near(r.hookHold.at3s!, 1); assert.equal(r.hookHold.at30s, null); assert.deepEqual(r.drops, []);
  const partial = analyzeRetention({ duration: 100, points: curve(() => 0.8).filter((p) => p.t >= 0.1 && p.t <= 0.8) });
  assert.equal(partial.hookHold.at3s, null); near(partial.hookHold.at30s!, 0.8);
  assert.match(partial.rule, /Collect/);
});

test("small alternating noise and isolated outliers do not create editing claims", () => {
  const points = curve((t) => 0.8 + (Math.round(t * 400) % 2 ? 0.005 : -0.005), 400);
  points[200].retained = 1.8;
  const r = analyzeRetention({ duration: 100, points });
  assert.deepEqual(r.drops, []); assert.deepEqual(r.rewatchSpikes, []); assert.match(r.rule, /Keep the current pacing/);
});

test("sorting, duplicate medians and unequal sample density preserve the underlying signal", () => {
  const fn = (t: number) => 1 - 0.3 * ramp(t, 0.1, 0.2);
  const points = curve(fn), extra = Array.from({ length: 50 }, (_, i) => ({ t: 0.4 + i / 10000, retained: fn(0.4 + i / 10000) }));
  const baseline = analyzeRetention({ duration: 100, points });
  const r = analyzeRetention({ duration: 100, points: [...points, ...extra, { t: 0.1, retained: fn(0.1) }, { t: 0.1, retained: 8 }].reverse() });
  near(r.drops[0].start, baseline.drops[0].start); near(r.drops[0].change, baseline.drops[0].change);
  assert.deepEqual(r, analyzeRetention({ duration: 100, points: [...points, ...extra, { t: 0.1, retained: fn(0.1) }, { t: 0.1, retained: 8 }] }));
});

test("context attribution chooses maximum overlap, ignores invalid context and does not mutate input", () => {
  const input: RetentionInput = { duration: 100, points: curve((t) => 1 - 0.3 * ramp(t, 0.4, 0.5)),
    beats: [{ start: 40, end: 42, label: "Tiny" }, { start: 42, end: 60, label: "Main beat" }, { start: NaN, label: "Invalid" }],
    transcript: [{ start: 41, end: 50, text: "The main explanation." }, { start: 5, end: 3, text: "Invalid" }] };
  const before = structuredClone(input);
  Object.freeze(input.points); Object.freeze(input.beats); Object.freeze(input.transcript); Object.freeze(input);
  const r = analyzeRetention(input);
  assert.equal(r.drops[0].beat?.label, "Main beat"); assert.equal(r.drops[0].transcript?.text, "The main explanation.");
  assert.deepEqual(input, before); assert.deepEqual(r, analyzeRetention(input));
  assert.ok(!/caused|because/i.test(r.rule));
});

test("more than three separate drops are capped, with finite slopes even on a very short clip", () => {
  const r = analyzeRetention({ duration: 0.01, points: curve((t) => 1 - [0.1, 0.3, 0.5, 0.7].reduce((sum, start) => sum + 0.1 * ramp(t, start, start + 0.03), 0), 400) });
  assert.equal(r.drops.length, 3);
  for (const d of r.drops) assert.ok([d.start, d.end, d.slope, d.change, d.lostPct!, d.lostPercentagePoints!].every(Number.isFinite));
  assert.deepEqual(r.hookHold, { at3s: null, at30s: null });
});

test("zero viewers, a flat loop plateau and relative values outside their scale remain safe", () => {
  const zero = analyzeRetention({ duration: 100, points: curve(() => 0) });
  assert.equal(zero.hookHold.at3s, 0); assert.deepEqual(zero.drops, []); assert.deepEqual(zero.rewatchSpikes, []);
  const plateau = analyzeRetention({ duration: 100, points: curve((t) => 0.8 + 0.4 * ramp(t, 0.35, 0.4) - 0.4 * ramp(t, 0.6, 0.65), 400) });
  assert.equal(plateau.rewatchSpikes.length, 1); near(plateau.rewatchSpikes[0].peak, 50, 1);
  const relative = analyzeRetention({ duration: 100, metric: "relativeRetentionPerformance", points: [{ t: 0, retained: 2 }, { t: 0.03, retained: 0.5 }] });
  assert.equal(relative.samples, 1); assert.equal(relative.relativeHook!.at3s, 0.5);
});
