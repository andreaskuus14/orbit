import { test } from "node:test";
import assert from "node:assert/strict";
import { packagingFeatures, fitPackaging, predictPackaging, rankPackaging, PACKAGING_KEYS, type PackagingHistory, type PackagingCandidate } from "../src/lib/packaging-pure.ts";

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const row = (extra: Partial<PackagingHistory> = {}): PackagingHistory => ({ title: "Garden design notes", ctr: 0.05, impressions: 10000, avgViewPct: 65, publishedAt: "2026-01-01T12:00:00Z", isShort: false, ...extra });
function signal(isShort = false): PackagingHistory[] {
  return Array.from({ length: 160 }, (_, i) => {
    const number = i % 2, contrast = Math.floor(i / 2) % 2;
    return row({ title: `Garden ${number ? "7 " : ""}${"design ".repeat(1 + Math.floor(i / 4) % 5)}notes`,
      ctr: sigmoid(-3 + (isShort ? -1.2 : 1.2) * number + 0.8 * contrast), isShort,
      thumbFeatures: { contrast, faces: 1, textWords: 3, dominantHue: 180 } });
  });
}
const candidate = (number: boolean, contrast: number): PackagingCandidate => ({ title: `Garden ${number ? "7 " : ""}design design notes`, thumbFeatures: { contrast, faces: 1, textWords: 3, dominantHue: 180 } });

test("features cover title syntax, real emoji clusters, keyword overlap and circular hue", () => {
  const title = "I found 7 HIDDEN garden secrets: Why? 👨‍👩‍👧‍👦 🇪🇪";
  const f = packagingFeatures({ title, thumbFeatures: { faces: 2, textWords: 4, contrast: 0.8, dominantHue: 360 } }, ["garden", "secrets"]);
  const value = (key: typeof PACKAGING_KEYS[number]) => f[PACKAGING_KEYS.indexOf(key)]!;
  assert.equal(value("number"), 1); assert.equal(value("question"), 1); assert.equal(value("colon"), 1); assert.equal(value("firstPerson"), 1);
  assert.ok(value("curiosity") > 0 && value("caps") > 0 && value("caps") < 1 && value("overlap") > 0);
  near(value("emoji"), 2 / 3, 1e-12); near(value("faces"), 2 / 3, 1e-12); near(value("textWords"), 0.4, 1e-12);
  near(value("hueSin"), 0, 1e-12); near(value("hueCos"), 1, 1e-12);
  assert.equal(packagingFeatures({ title: "© 2026, 123" })[7], 0);
  assert.ok(packagingFeatures({ title: "Garden" }).slice(9).every((x) => x === null));
});

test("weighted closed-form ridge recovers known independent title and thumbnail signals", () => {
  const model = fitPackaging(signal());
  assert.equal(model.mode, "fitted"); assert.equal(model.samples, 160);
  assert.ok(model.weights[PACKAGING_KEYS.indexOf("number")] > 1);
  assert.ok(model.weights[PACKAGING_KEYS.indexOf("contrast")] > 0.65);
  for (const number of [false, true]) for (const contrast of [0, 1]) {
    const prediction = predictPackaging(model, candidate(number, contrast));
    near(prediction.predictedCtr, sigmoid(-3 + 1.2 * +number + 0.8 * contrast), 0.015);
    assert.ok(prediction.interval.low <= prediction.predictedCtr && prediction.predictedCtr <= prediction.interval.high);
    assert.equal(prediction.reasons.length, 3);
  }
  const ranked = rankPackaging(signal(), [candidate(false, 0), candidate(true, 1)]);
  assert.equal(ranked[0].candidateIndex, 1); assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
  assert.ok(ranked[0].reasons.some((r) => /number.*raises/i.test(r)));
  assert.ok(ranked[0].reasons.some((r) => /contrast.*raises/i.test(r)));
});

test("Shorts and long-form learn separate, opposite title effects", () => {
  const history = [...signal(false), ...signal(true)], options = [candidate(false, 0), candidate(true, 0)];
  assert.equal(rankPackaging(history, options, false)[0].candidateIndex, 1);
  assert.equal(rankPackaging(history, options, true)[0].candidateIndex, 0);
  assert.deepEqual(fitPackaging(history, true), fitPackaging(signal(true), true));
  assert.deepEqual(fitPackaging(history, false), fitPackaging(signal(false), false));
});

test("sqrt(impressions), not row count, controls the fitted baseline", () => {
  const history = [...Array.from({ length: 8 }, () => row({ ctr: 0.1, impressions: 1e8 })), ...Array.from({ length: 8 }, () => row({ ctr: 0.01, impressions: 100 }))];
  const model = fitPackaging(history), predicted = predictPackaging(model, { title: history[0].title }).predictedCtr;
  const logit = (x: number) => Math.log(x / (1 - x));
  near(predicted, sigmoid((10000 * logit(0.1) + 10 * logit(0.01)) / 10010), 1e-10);
  assert.ok(predicted > 0.09); assert.ok(model.effectiveSamples < model.samples);
});

test("fewer than 8 valid rows uses explicit, wide-interval priors", () => {
  for (const n of [0, 1, 7]) {
    const history = signal().slice(0, n), model = fitPackaging(history), ranked = rankPackaging(history, [candidate(false, 0)]);
    assert.equal(model.mode, "prior"); assert.equal(model.samples, n); assert.equal(ranked[0].mode, "prior");
    assert.equal(ranked[0].reasons.length, 3); assert.ok(ranked[0].reasons.every((r) => r.includes("starting prior")));
    assert.ok(ranked[0].interval.high - ranked[0].interval.low > 0.1);
  }
  assert.equal(fitPackaging(signal().slice(0, 8)).mode, "fitted");
});

test("singular/constant features and endpoint CTRs stay finite with regularisation", () => {
  for (const ctr of [0, 1, 0.05]) for (const penalty of [0, -1, NaN, Infinity, 1e9]) {
    const model = fitPackaging(Array.from({ length: 8 }, () => row({ ctr })), false, penalty);
    const r = predictPackaging(model, { title: "??? 999 😀", thumbFeatures: { faces: 20, contrast: 1, dominantHue: -720 } });
    assert.ok([...model.weights, ...model.means, ...model.inverse.flat(), r.predictedCtr, r.interval.low, r.interval.high].every(Number.isFinite));
    assert.ok(r.interval.low > 0 && r.interval.high < 1 && r.interval.low <= r.predictedCtr && r.predictedCtr <= r.interval.high);
  }
});

test("invalid history is excluded; invalid thumbnail values are unknown, not fatal", () => {
  const invalid = [row({ ctr: NaN }), row({ ctr: 5 }), row({ ctr: -0.1 }), row({ impressions: 0 }), row({ impressions: Infinity }),
    row({ publishedAt: "bad" }), row({ title: " " }), row({ avgViewPct: NaN }), row({ avgViewPct: -1 })];
  assert.equal(fitPackaging(invalid).samples, 0);
  const f = packagingFeatures({ title: "Garden", thumbFeatures: { faces: NaN, textWords: Infinity, contrast: -2, dominantHue: Infinity } });
  assert.equal(f[9], null); assert.equal(f[10], null); assert.equal(f[11], 0); assert.equal(f[12], null);
  assert.ok(Number.isFinite(rankPackaging(invalid, [{ title: "" }])[0].predictedCtr));
});

test("unknown thumbnails don't masquerade as zero contrast or zero faces", () => {
  const model = fitPackaging(signal()), c = { title: "Garden design design notes" };
  const imputed = { title: c.title, thumbFeatures: { faces: model.means[9] * 3, textWords: model.means[10] * 10, contrast: model.means[11] } };
  near(predictPackaging(model, c).predictedCtr, predictPackaging(model, imputed).predictedCtr, 1e-12);
});

test("noisy data produces wider prediction intervals than clean signal", () => {
  const clean = signal(), noisy = clean.map((r, i) => ({ ...r, ctr: sigmoid(Math.log(r.ctr / (1 - r.ctr)) + (i % 2 ? 1 : -1) * (Math.floor(i / 4) % 2 ? 1 : -1)) }));
  const a = predictPackaging(fitPackaging(clean), candidate(true, 1)), b = predictPackaging(fitPackaging(noisy), candidate(true, 1));
  assert.ok(b.interval.high - b.interval.low > a.interval.high - a.interval.low);
});

test("top-performer vocabulary is personal and never learns from candidates", () => {
  const history = Array.from({ length: 12 }, (_, i) => row({ title: i < 3 ? "Lantern garden discovery" : "Plain workshop notes", ctr: i < 3 ? 0.12 : 0.02 }));
  const m = fitPackaging(history);
  assert.ok(m.keywords.includes("lantern")); assert.ok(!m.keywords.includes("workshop"));
  const before = JSON.stringify(m); predictPackaging(m, { title: "Unseen marmalade comet" }); assert.equal(JSON.stringify(m), before);
});

test("ranking is deterministic, order-stable for ties, and never mutates inputs", () => {
  const history = signal(), candidates = Object.freeze([Object.freeze(candidate(false, 0)), Object.freeze(candidate(false, 0))]);
  const original = JSON.stringify(history), a = rankPackaging(history, candidates), b = rankPackaging([...history].reverse(), candidates);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(history), original); assert.deepEqual(a.map((r) => r.candidateIndex), [0, 1]);
  assert.deepEqual(rankPackaging(history, []), []);
});
