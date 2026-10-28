import { test } from "node:test";
import assert from "node:assert/strict";
import { accuracy, curve, emptyForecasts, fitCurves, forecastAll, forecastProblem, forecastShort, hintFor, remember } from "../src/lib/clips/forecast-pure.ts";
import type { LearnRec, Stats } from "../src/lib/clips/learn-pure.ts";

const H = 3_600_000, NOW = Date.parse("2026-10-28T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`;
const st = (pub: number, h: number, views: number, extra: Partial<Stats> = {}): Stats => ({ at: iso(pub + h * H), views, likes: 0, comments: 0, ...extra });
/** Synthetic Short whose views follow a power curve A·h^k; `upTo` = hours of data so far. */
function short(i: number, A: number, k: number, upTo: number, extra: Partial<LearnRec> = {}): LearnRec {
  const pub = NOW - upTo * H, v = (h: number) => Math.round(A * h ** k);
  const snaps: LearnRec["snaps"] = {};
  for (const [key, h] of [["24h", 25], ["48h", 49], ["72h", 73], ["7d", 170]] as const) if (h <= upTo) snaps[key] = st(pub, h, v(h));
  return { videoId: vid(i), jobId: "j", clipId: `c${i}`, title: `t${i}`, hook: "Why did he do that?", reason: "", layout: "fit", captions: "karaoke",
    durationSec: 25, sourceChannel: "x", kind: "other", publishedAt: iso(pub), snaps, latest: st(pub, upTo, v(upTo)), ...extra };
}
const history = (n: number, k = 0.5) => Array.from({ length: n }, (_, i) => short(i, 200 + i * 150, k, 400));

test("curve: points from snapshots and latest, by age", () => {
  const r = short(1, 100, 0.5, 30);
  assert.deepEqual(curve(r).map((p) => p.h), [25, 30]);
  assert.deepEqual(curve({ ...r, publishedAt: undefined }), []);
});

test("log-linear fit recovers a power-law channel and forecasts within range", () => {
  const hist = history(5), fit = fitCurves(hist)!;
  assert.ok(fit && Math.abs(fit.b + 0.5) < 0.02, `slope ${fit?.b}`);
  for (const age of [6, 24, 60]) {
    const f = forecastShort(short(99, 1000, 0.5, age), hist, fit)!, truth = 1000 * 170 ** 0.5;
    assert.equal(f.method, "fit");
    assert.ok(Math.abs(f.p50 / truth - 1) < 0.05, `age ${age}: ${f.p50} vs ${truth}`);
    assert.ok(f.lo <= f.p50 && f.p50 <= f.hi && f.lo >= f.views);
  }
});

test("noisy curves widen the range; the truth stays inside", () => {
  const hist = Array.from({ length: 8 }, (_, i) => short(i, 300, 0.5 + (i % 2 ? 0.08 : -0.08), 400));
  const f = forecastShort(short(99, 300, 0.5, 24), hist)!, truth = 300 * 170 ** 0.5;
  assert.ok(f.hi / f.lo > 1.2 && f.lo <= truth && truth <= f.hi, JSON.stringify(f));
});

test("nearest-neighbour fallback with little history; nothing without history", () => {
  const hist = history(2);
  assert.equal(fitCurves(hist), null);
  const f = forecastShort(short(99, 500, 0.5, 24), hist)!;
  assert.equal(f.method, "nn");
  assert.ok(Math.abs(f.p50 / (500 * 170 ** 0.5) - 1) < 0.1 && f.lo < f.p50 && f.p50 < f.hi, JSON.stringify(f));
  assert.equal(forecastShort(short(99, 500, 0.5, 24), []), null);
  assert.equal(forecastShort(short(99, 500, 0.5, 2), hist), null, "no past point within 2× of the age");
});

test("forecastAll: only Shorts under 7 days, newest first; views never forecast to drop", () => {
  const recs = [...history(4), short(50, 100, 0.5, 30), short(51, 100, 0.5, 10), short(52, 0, 0.5, 24)];
  const fs = forecastAll(recs, NOW);
  assert.deepEqual(fs.map((f) => f.videoId), [vid(51), vid(52), vid(50)]);
  assert.ok(fs.every((f) => f.lo >= f.views));
});

test("hints: retention first, then under-performing length/hook, else keep", () => {
  const recs = [1, 2, 3].map((i) => short(i, 100, 0.5, 400, { latest: { at: iso(NOW), views: 1, likes: 0, comments: 0, avgViewPct: 80 } }));
  const weak = short(9, 100, 0.5, 24, { latest: { at: iso(NOW), views: 1, likes: 0, comments: 0, avgViewPct: 50 } });
  const none = { over: [], under: [] };
  assert.deepEqual(hintFor(weak, [...recs, weak], none), { key: "retention", vars: { pct: 50, usual: 80 } });
  const r = short(9, 100, 0.5, 24, { durationSec: 45 });
  const b = { over: [{ dim: "length" as const, label: "20-30", n: 3, value: 1.5 }, { dim: "hookStyle" as const, label: "question", n: 3, value: 1.4 }],
    under: [{ dim: "length" as const, label: "40+", n: 3, value: 0.6 }] };
  assert.deepEqual(hintFor(r, recs, b), { key: "lengthTo", vars: { now: "40+", to: "20-30" } });
  assert.deepEqual(hintFor({ ...r, durationSec: 25 }, recs, b), { key: "keep", vars: { dim: "length", label: "20-30" } });
  assert.deepEqual(hintFor({ ...r, durationSec: 25, hook: "he lost it" }, recs, { over: b.over, under: [{ dim: "hookStyle", label: "statement", n: 3, value: 0.5 }] }),
    { key: "hookTo", vars: { now: "statement", to: "question" } });
  assert.equal(hintFor(r, recs, none), null);
});

test("stored forecasts: first one kept, accuracy once 7d views arrive", () => {
  const f = { videoId: vid(1), title: "t", publishedAt: iso(NOW), ageH: 24, views: 10, p50: 100, lo: 80, hi: 130, method: "fit" as const };
  const s = remember(emptyForecasts(), [f], NOW)!;
  assert.equal(forecastProblem(s), "");
  assert.equal(remember(s, [{ ...f, p50: 999 }], NOW), null);
  assert.equal(forecastProblem({ v: 1, items: { x: { at: "a", ageH: -1, p50: 1, lo: 1, hi: 1 } } }), "not a forecast state");
  const rec = short(1, 100, 0.5, 24);
  assert.equal(accuracy(s, [rec]), null);
  rec.snaps["7d"] = st(NOW, 170, 120);
  assert.deepEqual(accuracy(s, [rec]), { n: 1, medianErrPct: 17, inRange: 1 });
});
