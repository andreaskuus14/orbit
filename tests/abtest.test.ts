// Honest A/B tests checked against simulations (seeded, so every run is the same).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_OPTS, RATE_OPTS, abLine, abText, decide, halfWidth, logLR, logSpread, meanSteps, pooledSteps, rateSteps, type MeanObs, type RateObs } from "../src/lib/abtest-pure.ts";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const RUNS = 2000;

/** Alternating A/B Shorts with log-normal views (sd 1 on the log scale, like real Shorts), a look after every one. */
function simMeans(r: () => number, effect: number, perArm: number, sd = 1): MeanObs[] {
  const out: MeanObs[] = [];
  for (let i = 0; i < perArm; i++) for (const arm of ["A", "B"] as const) out.push({ arm, x: Math.log(Math.max(1, Math.round(Math.exp(6 + sd * normal(r) + (arm === "B" ? effect : 0))))) });
  return out;
}

test("formulas: Λ grows with the effect, the interval shrinks with more data", () => {
  assert.ok(logLR(1, 0.05, 0.5) > logLR(0.2, 0.05, 0.5));
  assert.ok(halfWidth(0.01, 0.5) < halfWidth(0.1, 0.5));
  assert.ok(Math.abs(logLR(0, 0.1, 0.5) - 0.5 * Math.log(0.1 / 0.35)) < 1e-12);
});

test("no difference, peeking after every Short up to 60 a side: false winner rate ≤ 5 %", () => {
  const r = rng(1);
  let wrong = 0, same = 0;
  for (let k = 0; k < RUNS; k++) {
    const d = decide(meanSteps(simMeans(r, 0, 60), LOG_OPTS.minVar), LOG_OPTS);
    if (d.verdict === "better" || d.verdict === "worse") wrong++;
    if (d.verdict === "same") same++;
  }
  assert.ok(wrong / RUNS <= 0.05, `false winner rate ${wrong / RUNS}`);
  assert.ok(same >= 0, "same is allowed");
});

test("no difference with small, noisy samples (sd 1.5, up to 20 a side) and long runs (200 a side): still ≤ 5 %", () => {
  const r = rng(2);
  let wrong = 0;
  for (let k = 0; k < RUNS; k++) { const v = decide(meanSteps(simMeans(r, 0, 20, 1.5), LOG_OPTS.minVar), LOG_OPTS).verdict; if (v === "better" || v === "worse") wrong++; }
  assert.ok(wrong / RUNS <= 0.05, `false winner rate ${wrong / RUNS}`);
  let long = 0;
  for (let k = 0; k < 1000; k++) { const v = decide(meanSteps(simMeans(r, 0, 200), LOG_OPTS.minVar), LOG_OPTS).verdict; if (v === "better" || v === "worse") long++; }
  assert.ok(long / 1000 <= 0.05, `long-run false winner rate ${long / 1000}`);
});

test("a real 2× difference is found, in the right direction", () => {
  const r = rng(3);
  let right = 0, wrongWay = 0;
  for (let k = 0; k < 500; k++) { const v = decide(meanSteps(simMeans(r, Math.log(2), 60), LOG_OPTS.minVar), LOG_OPTS).verdict; if (v === "better") right++; if (v === "worse") wrongWay++; }
  assert.ok(right / 500 >= 0.8, `power ${right / 500}`);
  assert.ok(wrongWay / 500 <= 0.01);
});

test("never a winner from a handful: 4 a side with a huge gap stays too early", () => {
  const obs: MeanObs[] = [];
  for (let i = 0; i < 4; i++) obs.push({ arm: "A", x: Math.log(100) + i * 0.01 }, { arm: "B", x: Math.log(10000) + i * 0.01 });
  const d = decide(meanSteps(obs, LOG_OPTS.minVar), LOG_OPTS);
  assert.equal(d.verdict, "early");
  assert.ok(d.more! >= 2 && Number.isFinite(d.more!));
  assert.equal(abLine(d).key, "ab.early");
});

test("lots of data and no difference ends as 'no real difference'", () => {
  const r = rng(4);
  let same = 0;
  for (let k = 0; k < 200; k++) if (decide(meanSteps(simMeans(r, 0, 400, 0.6), LOG_OPTS.minVar), LOG_OPTS).verdict === "same") same++;
  assert.ok(same / 200 >= 0.7, `same ${same / 200}`);
});

test("rates: no difference, peeking after every task up to 200 a side: ≤ 5 %; a 25-point gap is found", () => {
  const r = rng(5);
  const sim = (pA: number, pB: number, n: number): RateObs[] => Array.from({ length: n }, () => [{ arm: "A" as const, n: r() < pA ? 1 : 0, of: 1 }, { arm: "B" as const, n: r() < pB ? 1 : 0, of: 1 }]).flat();
  let wrong = 0, found = 0;
  for (let k = 0; k < RUNS; k++) { const v = decide(rateSteps(sim(0.6, 0.6, 200)), RATE_OPTS).verdict; if (v === "better" || v === "worse") wrong++; }
  for (let k = 0; k < 300; k++) if (decide(rateSteps(sim(0.5, 0.75, 200)), RATE_OPTS).verdict === "better") found++;
  assert.ok(wrong / RUNS <= 0.05, `false winner rate ${wrong / RUNS}`);
  assert.ok(found / 300 >= 0.8, `power ${found / 300}`);
});

test("one-sample vs each Short's own comparables (estimated spread): ≤ 5 % false lessons; a real 2× lift is found", () => {
  const r = rng(6); // comparables per Short: 5-14, spread estimated from them (not known)
  const run = (lift: number, n: number) => {
    const obs = [];
    for (let i = 0; i < n; i++) {
      const base = Array.from({ length: 5 + Math.floor(r() * 10) }, () => Math.exp(6 + normal(r)));
      const s = logSpread(base)!, views = Math.exp(6 + normal(r) + lift);
      obs.push({ x: Math.log(views) - s.mean, ss: s.ss, df: s.df, w: 1 + 1 / s.n });
    }
    return decide(pooledSteps(obs), LOG_OPTS).verdict;
  };
  let wrong = 0, found = 0;
  for (let k = 0; k < RUNS; k++) { const v = run(0, 40); if (v === "better" || v === "worse") wrong++; }
  for (let k = 0; k < 300; k++) if (run(Math.log(2), 40) === "better") found++;
  assert.ok(wrong / RUNS <= 0.05, `false lesson rate ${wrong / RUNS}`);
  assert.ok(found / 300 >= 0.7, `power ${found / 300}`);
});

test("plain words", () => {
  assert.equal(abText({ verdict: "better", est: 1, lo: 0.1, hi: 2, nA: 9, nB: 9, p: 0.01 }, "A", "B"), "B is better (sure enough)");
  assert.equal(abText({ verdict: "worse", est: -1, lo: -2, hi: -0.1, nA: 9, nB: 9, p: 0.01 }, "A", "B"), "A is better (sure enough)");
  assert.equal(abText({ verdict: "same", est: 0, lo: -0.1, hi: 0.1, nA: 99, nB: 99, p: 1 }), "No real difference");
  assert.equal(abText({ verdict: "early", est: 0, lo: -1, hi: 1, nA: 3, nB: 3, p: 1, more: 12 }), "Too early to tell (needs ~12 more)");
  assert.equal(abText({ verdict: "early", est: 0, lo: -1, hi: 1, nA: 3, nB: 3, p: 1, more: Infinity }), "Too early to tell (needs many more)");
  assert.equal(logSpread([1, 2, 3, 4]), null);
});
