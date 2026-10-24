import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalSecs, arrivalSpread, detuneRatios, easeInStop, newUnseen, offscreenEdge, unseenAngle, unseenStep, watched } from "../src/lib/alien-behaviour-pure.ts";

test("alien-behaviour: ease-in arrival never overshoots, speeds up to the end and stops dead", () => {
  for (const k of [0, 0.25]) {
    let prev = 0, prevV = -1;
    const N = 100;
    for (let i = 1; i <= N; i++) {
      const e = easeInStop(i / N, k), v = e - prev;
      assert.ok(e >= prev && e <= 1, "monotonic, inside [0, 1]");
      assert.ok(v >= prevV - 1e-12, "speed only grows: no ease-out tail");
      prev = e; prevV = v;
    }
    assert.equal(easeInStop(1, k), 1);
    assert.equal(easeInStop(1.5, k), 1); // after the end: still, exactly at the goal
    assert.ok(prevV > 1.5 / N, "the last step is the fastest: a hard stop, not a settle");
  }
  assert.equal(easeInStop(NaN), 0);
  assert.equal(easeInStop(-1), 0);
});

test("alien-behaviour: arrival timing and moon convergence are bounded", () => {
  assert.ok(arrivalSecs(0) > 0 && arrivalSecs(1e6) <= 1.5 && arrivalSecs(1e6, true) <= 0.9);
  assert.ok(Number.isFinite(arrivalSecs(NaN)));
  assert.ok(arrivalSpread(0) > 2 && arrivalSpread(1) === 1 && arrivalSpread(2) === 1);
});

test("alien-behaviour: watched estimate", () => {
  assert.equal(watched(0, 0, true), 1);
  assert.equal(watched(0, 0, false), 0);
  assert.equal(watched(1, 0, true), 0); // turning fast
  assert.equal(watched(0, 1.5, true), 0); // pointer far away
  assert.ok(watched(0.3, 0.9, true) > 0 && watched(0.3, 0.9, true) < 1);
  assert.equal(watched(NaN, NaN, true), 1);
});

test("alien-behaviour: unseen change only while unwatched, debounced and spaced out", () => {
  const s = newUnseen();
  let snaps = 0;
  for (let i = 0; i < 600; i++) if (unseenStep(s, 1 / 60, 1)) snaps++; // 10 s watched
  assert.equal(snaps, 0);
  assert.equal(unseenStep(s, 1 / 60, 0), false); // one unwatched frame: not yet
  for (let i = 0; i < 10 && !unseenStep(s, 1 / 60, 0); i++);
  assert.equal(s.n, 1);
  for (let i = 0; i < 120; i++) if (unseenStep(s, 1 / 60, 0)) snaps++; // 2 s: inside the gap
  assert.equal(snaps, 0);
  assert.ok(Math.abs(unseenAngle(1, 0) - unseenAngle(2, 0)) > 0.3);
  assert.ok(unseenAngle(-3, 1) >= 0 && unseenAngle(1e9, 1) < Math.PI * 2);
});

test("alien-behaviour: off-screen edge fires once per exit", () => {
  const s = { off: false };
  assert.deepEqual([false, true, true, false, true].map((o) => offscreenEdge(s, o)), [false, true, false, false, true]);
});

test("alien-behaviour: detuned cluster is symmetric around unison", () => {
  const r = detuneRatios(5, 30);
  assert.equal(r.length, 5);
  assert.equal(r[2], 1);
  assert.ok(Math.abs(r[0] * r[4] - 1) < 1e-12);
  assert.deepEqual(detuneRatios(1, 30), [1]);
});
