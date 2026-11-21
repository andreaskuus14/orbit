// Property-based tests (fast-check, MIT) for the clip virality score (weights, ridge fit, breakdown) and the moment-signal fusion weights.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { KEYS, PRIOR, fitRidge, predict, priorModel, rankScore, scoreFrom, type FKey, type FVec, type Model } from "../src/lib/clips/score-pure.ts";
import { SIGNAL_KEYS, WEIGHTS, fuseSignals, type Signals } from "../src/lib/clips/moments-pure.ts";

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const fvec = fc.record(Object.fromEntries(KEYS.map((k) => [k, unit])) as Record<FKey, fc.Arbitrary<number>>, { requiredKeys: [] }) as fc.Arbitrary<FVec>;
const weights = fc.record(Object.fromEntries(KEYS.map((k) => [k, fc.double({ min: -2, max: 2, noNaN: true })])) as Record<FKey, fc.Arbitrary<number>>);
const model = fc.oneof(fc.constant(priorModel()), fc.record({ w: weights, b: fc.double({ min: -2, max: 2, noNaN: true }), n: fc.integer({ min: 8, max: 100 }), learned: fc.constant(true) })) as fc.Arbitrary<Model>;

test("virality score is a whole number 0–100, a missing signal counts exactly like a neutral 0.5", () => {
  fc.assert(fc.property(model, fvec, (m, x) => {
    const v = scoreFrom(m, x, {});
    assert.ok(Number.isInteger(v.score) && v.score >= 0 && v.score <= 100);
    assert.ok(v.mult > 0);
    const filled = Object.fromEntries(KEYS.map((k) => [k, x[k] ?? 0.5])) as FVec;
    assert.equal(predict(m, filled), predict(m, x));
  }), { numRuns: 3000 });
});

test("regression (seed 1876556059): a very low prediction still shows a multiplier above 0, never 0.00×", () => {
  const m = { ...priorModel(), w: Object.fromEntries(KEYS.map((k) => [k, -2])) as Model["w"], b: -2, learned: true, n: 50 } as Model;
  const x = Object.fromEntries(KEYS.map((k) => [k, 1])) as FVec;
  assert.ok(scoreFrom(m, x, {}).mult > 0);
});

test("raising a signal with a positive weight never lowers the score (and a negative weight never raises it)", () => {
  fc.assert(fc.property(model, fvec, fc.constantFrom(...KEYS), unit, (m, x, k, to) => {
    const a = { ...x, [k]: Math.min(x[k] ?? 0.5, to) }, b = { ...x, [k]: Math.max(x[k] ?? 0.5, to) };
    const sa = scoreFrom(m, a, {}).score, sb = scoreFrom(m, b, {}).score;
    if (m.w[k] >= 0) assert.ok(sb >= sa, `${k} up: ${sa} → ${sb}`); else assert.ok(sb <= sa);
  }), { numRuns: 3000 });
});

test("the breakdown shows at most 3 reasons each way, each pulling the way it is listed, biggest first", () => {
  fc.assert(fc.property(model, fvec, (m, x) => {
    const v = scoreFrom(m, x, { lo: 20, hi: 35, len: 30, claude10: 7, chatX: 2, creator: "c", cm: 1.2, kind: "fail", km: 1.1 });
    assert.ok(v.up.length <= 3 && v.down.length <= 3);
    v.up.forEach((f, i) => { assert.ok(f.pts >= 1 && x[f.key] !== undefined); if (i) assert.ok(f.pts <= v.up[i - 1].pts); });
    v.down.forEach((f, i) => { assert.ok(f.pts <= -1 && x[f.key] !== undefined); if (i) assert.ok(f.pts >= v.down[i - 1].pts); });
    assert.equal(new Set([...v.up, ...v.down].map((f) => f.key)).size, v.up.length + v.down.length, "a reason is never on both sides");
  }), { numRuns: 2000 });
});

test("ridge fit: no data keeps the priors; Shorts that behave exactly like the priors teach the priors back", () => {
  const z = fitRidge([]);
  for (const k of KEYS) assert.ok(Math.abs(z.w[k] - PRIOR[k]) < 1e-9);
  fc.assert(fc.property(fc.array(fvec, { minLength: 1, maxLength: 40 }), fc.double({ min: -1, max: 1, noNaN: true }), (xs, b) => {
    const m = fitRidge(xs.map((x) => ({ x, y: b + predict(priorModel(), x) })));
    for (const k of KEYS) assert.ok(Math.abs(m.w[k] - PRIOR[k]) <= 0.002, `${k}: ${m.w[k]} vs ${PRIOR[k]}`);
    assert.ok(Math.abs(m.b - b) <= 0.002);
    for (const k of KEYS) assert.ok(Number.isFinite(m.w[k]));
  }), { numRuns: 500 });
});

test("review order score stays on the 0–100 scale for any editor rating (0–1 or 0–100)", () => {
  fc.assert(fc.property(fc.oneof(unit, fc.double({ min: 1.0001, max: 100, noNaN: true })), (s) => {
    const r = rankScore({ score: s });
    assert.ok(r >= 30 && r <= 55 && Number.isInteger(r), `${s} → ${r}`);
  }), { numRuns: 2000 });
});

test("moment fusion weights: the fused curve is a weighted mean, so it never leaves the range of the signals it mixes", () => {
  const sig = (n: number) => fc.array(fc.oneof(fc.double({ min: 0, max: 50, noNaN: true }), fc.constant(NaN)), { minLength: n, maxLength: n });
  fc.assert(fc.property(fc.integer({ min: 6, max: 60 }).chain((n) => fc.tuple(fc.constant(n), fc.record(Object.fromEntries(SIGNAL_KEYS.map((k) => [k, sig(n)])), { requiredKeys: [] }))), ([secs, raw]) => {
    const f = fuseSignals(raw as Signals, secs);
    assert.equal(f.curve.length, secs);
    for (const k of f.used) assert.ok(WEIGHTS[k] > 0);
    const zs = f.used.flatMap((k) => f.z[k]!.filter(Number.isFinite));
    if (!zs.length) return assert.ok(f.curve.every((v) => v === 0));
    const lo = Math.min(0, ...zs), hi = Math.max(0, ...zs); // a second with no signal at all is 0
    for (const v of f.curve) assert.ok(Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9, `${v} outside ${lo}…${hi}`);
  }), { numRuns: 1500 });
});
