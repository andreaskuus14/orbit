import { test } from "node:test";
import assert from "node:assert/strict";
import { ELIGIBLE_N, MIN_HISTORY, STALE, bins, brier, eligible, hintText, parseStore, predictOne, score, step, train, weeklyLine,
  type Decision, type Item, type Prediction } from "../src/lib/predict-pure.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
// Deterministic PRNG (mulberry32) so the synthetic histories are the same on every run.
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const prop = (agent: string, kind = "research") => [{ key: `agent=${agent}`, label: `proposals from ${agent}` }, { key: `kind=${kind}`, label: `${kind} proposals` }];
let n = 0;
const dec = (ok: boolean, f = prop("atlas"), days = 1): Decision => ({ id: `proposal:${++n}`, area: "proposals", at: ago(days), ok, f });

test("Brier score and reliability bins on hand-checked numbers", () => {
  assert.equal(brier([{ p: 0.9, y: true }, { p: 0.1, y: false }]), 0.01);
  assert.equal(brier([{ p: 0.5, y: true }, { p: 0.5, y: false }]), 0.25, "a coin flip scores 0.25");
  assert.equal(brier([{ p: 1, y: false }]), 1);
  assert.equal(brier([]), null);
  const b = bins([{ p: 0.1, y: false }, { p: 0.15, y: true }, { p: 0.95, y: true }, { p: 1, y: true }]);
  assert.equal(b.length, 5);
  assert.deepEqual([b[0].n, b[0].meanP, b[0].rate], [2, 0.125, 0.5]);
  assert.deepEqual([b[4].n, b[4].rate], [2, 1], "p = 1 lands in the top bin");
  assert.equal(b[2].meanP, null);
});

test("calibration code: a calibrated synthetic forecaster matches its bins and beats an overconfident one", () => {
  const r = rng(7), xs = Array.from({ length: 5000 }, () => { const p = r(); return { p, y: r() < p }; });
  for (const b of bins(xs)) assert.ok(Math.abs(b.rate! - b.meanP!) < 0.04, `bin ${b.from}: rate ${b.rate} vs meanP ${b.meanP}`);
  assert.ok(Math.abs(brier(xs)! - 1 / 6) < 0.01, `E[p(1-p)] = 1/6 for uniform p, got ${brier(xs)}`);
  const over = xs.map((x) => ({ p: x.p >= 0.5 ? 0.99 : 0.01, y: x.y }));
  assert.ok(brier(over)! > brier(xs)! + 0.05, "overconfidence is punished");
  const flip = xs.map((x) => ({ p: 1 - x.p, y: x.y }));
  assert.ok(brier(flip)! > 0.4, "an inverted forecaster scores worse than a coin flip");
  // Biased: says 0.8 when the truth is 0.5 → that bin's observed rate shows the gap.
  const biased = Array.from({ length: 2000 }, () => ({ p: 0.8, y: r() < 0.5 }));
  const top = bins(biased).find((b) => b.n)!;
  assert.ok(top.meanP! - top.rate! > 0.25);
});

test("naive Bayes learns a synthetic owner and is roughly calibrated on fresh decisions", () => {
  const r = rng(42), rate: Record<string, number> = { atlas: 0.9, echo: 0.1, nova: 0.6 }, agents = Object.keys(rate);
  const make = (k: number, from: number) => Array.from({ length: k }, (_, i) => { const a = agents[Math.floor(r() * 3)]; return dec(r() < rate[a], prop(a), from + (i % 20)); });
  const m = train(make(300, 1), NOW), test = make(600, 0);
  const guesses = test.map((d) => ({ p: predictOne(m, d.f)!.p, y: d.ok }));
  const hits = guesses.filter((g) => (g.p >= 0.5) === g.y).length / guesses.length;
  assert.ok(hits > 0.75, `hit rate ${hits}`);
  assert.ok(brier(guesses)! < 0.18, `brier ${brier(guesses)} (truth-optimal ≈ 0.13)`);
  for (const b of bins(guesses)) if (b.n >= 50) assert.ok(Math.abs(b.rate! - b.meanP!) < 0.12, `bin ${b.from}: ${b.rate} vs ${b.meanP}`);
  const g = predictOne(m, prop("echo"))!;
  assert.ok(g.p < 0.25);
  assert.match(g.why, /proposals from echo: you approved \d+ of \d+/);
  assert.match(hintText(g), /^ORBIT thinks: reject, \d+%$/);
  assert.equal(hintText({ p: 0.87 }), "ORBIT thinks: approve, 87%");
});

test("recent decisions outweigh old ones; too little history means no guess", () => {
  const old = Array.from({ length: 20 }, (_, i) => dec(true, prop("echo"), 150 + i)), recent = Array.from({ length: 8 }, (_, i) => dec(false, prop("echo"), i));
  assert.ok(predictOne(train([...old, ...recent], NOW), prop("echo"))!.p < 0.5, "8 recent rejections beat 20 approvals from 5 months ago");
  assert.ok(predictOne(train(old, NOW), prop("echo"))!.p > 0.5);
  assert.equal(predictOne(train(recent.slice(0, MIN_HISTORY - 1), NOW), prop("echo")), null);
  assert.equal(predictOne(train(Array.from({ length: 9 }, (_, i) => dec(true, prop("x"), 200 + i)), NOW), prop("x")), null, "beyond 180 days nothing counts");
});

test("step: guesses once, never edits a guess, scores it when he decides, drops vanished items", () => {
  const hist = Array.from({ length: 10 }, (_, i) => dec(i < 9, prop("atlas"), i + 1));
  const item: Item = { id: "proposal:new", area: "proposals", f: prop("atlas") };
  const s1 = step([], hist, [item], NOW);
  assert.equal(s1.length, 1);
  assert.ok(s1[0].p > 0.7 && s1[0].outcome === undefined);
  const s2 = step(s1, [...hist, ...Array.from({ length: 20 }, () => dec(false, prop("atlas")))], [item], NOW + DAY);
  assert.deepEqual(s2, s1, "new history never rewrites a recorded guess");
  const s3 = step(s2, [...hist, { id: "proposal:new", area: "proposals", at: new Date(NOW + 2 * DAY).toISOString(), ok: false, f: prop("atlas") }], [], NOW + 2 * DAY);
  assert.equal(s3[0].outcome, false);
  assert.equal(score(s3, NOW + 2 * DAY).hits, 0, "a confident approve that he rejected is a miss");
  const s4 = step([{ ...s1[0], id: "proposal:gone" }], hist, [], NOW + STALE + DAY);
  assert.equal(s4.length, 0, "an item that vanished undecided drops its guess after STALE");
  assert.equal(step([], [], [item], NOW).length, 0, "no history, no guess");
});

test("step: a decision whose source lost the features (dismissed deal) trains on the guess's features", () => {
  const f = [{ key: "site=shady.ee", label: "offers on shady.ee" }];
  const preds: Prediction[] = Array.from({ length: 6 }, (_, i) => ({ id: `deal:${i}`, area: "deals", at: ago(10), p: 0.5, why: "", f }));
  const dismissed: Decision[] = preds.map((x) => ({ id: x.id, area: "deals", at: ago(1), ok: false, f: [] }));
  const s = step(preds, dismissed, [{ id: "deal:new", area: "deals", f }], NOW);
  const g = s.find((x) => x.id === "deal:new")!;
  assert.ok(g.p < 0.3, `p ${g.p}`);
  assert.match(g.why, /shady\.ee: you approved 0 of 6/);
});

test("weekly score, per-area rows and the Do & report suggestion", () => {
  const mk = (i: number, area: Prediction["area"], p: number, outcome: boolean, days = 1): Prediction => ({ id: `${area}:${i}`, area, at: ago(days + 1), p, why: "", f: [], outcome, decidedAt: ago(days) });
  const preds = [...Array.from({ length: ELIGIBLE_N }, (_, i) => mk(i, "hygiene", 0.9, i !== 0, i % 6)),
    ...Array.from({ length: ELIGIBLE_N }, (_, i) => mk(i, "clips", 0.8, i % 5 !== 0)), mk(99, "niches", 0.2, true, 20)];
  const s = score(preds, NOW, 7);
  assert.equal(s.n, 60, "the 20-day-old niche is outside the week");
  assert.deepEqual(s.areas.map((a) => [a.area, a.hits]), [["clips", 24], ["hygiene", 29]]);
  assert.match(weeklyLine(s), /^ORBIT guessed 60 of your decisions before you made them: 53 right \(88%\), Brier 0\.\d\d/);
  assert.equal(weeklyLine(score([], NOW)), "");
  assert.deepEqual(eligible(preds).map((e) => [e.area, e.autonomy, e.hits]), [["hygiene", "memory", 29]], "29/30 ≥ 90%; clips 24/30 is not");
  assert.deepEqual(eligible(preds.slice(1, ELIGIBLE_N)), [], "fewer than 30 decisions is never eligible");
});

test("parseStore refuses a broken file instead of wiping it", () => {
  assert.deepEqual(parseStore(""), { v: 1, users: {} });
  assert.equal(parseStore("{nope"), null);
  assert.equal(parseStore(JSON.stringify({ v: 1, users: { u: { preds: 3 } } })), null);
});
