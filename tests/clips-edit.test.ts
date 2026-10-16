import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASR_MAX_SEC, asrBudgetSec, asrPieces, asrRegions, frameArgs, groupSpans, keepSegments, markLoud, mergeRanked, renderFilter, retime, retimeWords, validateMoments, zoomExpr, zoomTimes,
  type Moment, type Pt, type Word,
} from "../src/lib/clips/pure.ts";

const r2 = (spans: { start: number; end: number }[]) => spans.map((s) => [Math.round(s.start * 100) / 100, Math.round(s.end * 100) / 100]);
const flat = (dur: number, v = 0.1): Pt[] => Array.from({ length: dur * 2 }, (_, i) => ({ t: i * 0.5 + 0.25, v }));
const mom = (start: number, end: number, score: number, title = "t"): Moment => ({ start, end, score, title, hook: "", reason: "" });

test("asrRegions: whole short videos, loudest padded stretches of long ones, budget grows with clip count", () => {
  assert.deepEqual(asrRegions([0.1, 0.2], 600, { maxSec: 45, count: 5 }), [{ start: 0, end: 600 }]);
  const rms = Array.from({ length: 7200 }, (_, i) => ((i >= 1200 && i < 1260) || (i >= 4000 && i < 4060) ? 0.9 : 0.05 + (i % 7) * 0.01)); // 1 h, loud at 600 s and 2000 s
  const reg = asrRegions(rms, 3600, { maxSec: 45, count: 5 });
  for (let i = 0; i < reg.length; i++) {
    assert.ok(reg[i].start >= 0 && reg[i].end <= 3600 && reg[i].end > reg[i].start);
    if (i) assert.ok(reg[i].start > reg[i - 1].end + 5, "merged and sorted");
  }
  for (const [a, b] of [[600, 630], [2000, 2030]]) assert.ok(reg.some((r) => r.start <= a - 15 && r.end >= b + 15), `covers ${a}-${b} with padding`);
  const total = (o: { maxSec: number; count: number }) => asrRegions(rms, 3600, o).reduce((s, r) => s + r.end - r.start, 0);
  assert.ok(total({ maxSec: 45, count: 5 }) < 3600 / 2);
  assert.ok(total({ maxSec: 45, count: 10 }) > total({ maxSec: 45, count: 1 }));
});

test("asrBudgetSec: ~20% of the video, ≥ 10 min, scaled by clip count, never over 25 min", () => {
  assert.equal(asrBudgetSec(3600, 5), 720);
  assert.equal(asrBudgetSec(1200, 5), 600);
  assert.ok(asrBudgetSec(3600, 10) > asrBudgetSec(3600, 1));
  for (const h of [2, 3, 5, 8]) for (const n of [1, 5, 10]) assert.ok(asrBudgetSec(h * 3600, n) <= ASR_MAX_SEC);
  assert.equal(asrBudgetSec(8 * 3600, 5), ASR_MAX_SEC);
  assert.ok(asrBudgetSec(700, 10) <= 700);
});

test("asrRegions: an 8 h stream transcribes ≤ 25 min, and finds a reaction spike in a quiet hour", () => {
  const n = 8 * 3600 * 2; // 0.5 s windows
  // Hours 0-3 loud steady game audio (0.4), hours 4-7 quiet (0.1) with one shout at 6 h; noise keeps candidates distinct.
  const rms = Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.4 : 0.1) + ((i * 7919) % 13) * 0.004 + (i >= 43200 && i < 43260 ? 0.5 : 0));
  const t0 = performance.now();
  const reg = asrRegions(rms, 8 * 3600, { maxSec: 45, count: 5 });
  assert.ok(performance.now() - t0 < 5000, "stays cheap");
  const total = reg.reduce((s, r) => s + r.end - r.start, 0);
  assert.ok(total <= ASR_MAX_SEC && total > ASR_MAX_SEC / 2, `total ${total}`);
  assert.ok(reg.some((r) => r.start <= 21600 && r.end >= 21630), "covers the shout at 6 h");
  for (let i = 1; i < reg.length; i++) assert.ok(reg[i].start > reg[i - 1].end, "sorted, merged");
});

test("asrPieces: ≤ 300 s pieces that overlap 5 s inside their region only", () => {
  assert.deepEqual(asrPieces([{ start: 0, end: 700 }]), [{ from: 0, start: 0, to: 300, sec: 300 }, { from: 295, start: 300, to: 600, sec: 300 }, { from: 595, start: 600, to: 700, sec: 100 }]);
  assert.deepEqual(asrPieces([{ start: 100, end: 250 }, { start: 1000, end: 1000.5 }]), [{ from: 100, start: 100, to: 250, sec: 150 }]);
});

test("groupSpans: about equal, time-ordered groups; cuts inside a span overlap", () => {
  assert.deepEqual(groupSpans([{ start: 0, end: 1800 }], 3), [[{ start: 0, end: 620 }], [{ start: 600, end: 1220 }], [{ start: 1200, end: 1800 }]]);
  const four = [{ start: 0, end: 100 }, { start: 200, end: 300 }, { start: 400, end: 500 }, { start: 600, end: 700 }];
  assert.deepEqual(groupSpans(four, 2), [four.slice(0, 2), four.slice(2)]);
  assert.deepEqual(groupSpans(four, 1), [four]);
  assert.equal(groupSpans([{ start: 0, end: 1000 }], 3).length, 3);
});

test("mergeRanked: final picks first (only real proposals), then the best scouts, no overlaps", () => {
  const P = [mom(0, 30, 0.9), mom(100, 130, 0.8), mom(200, 230, 0.7), mom(10, 40, 0.95)];
  const out = mergeRanked([mom(105, 128, 0.99, "B!"), mom(500, 530, 0.9, "invented")], P, 3);
  assert.deepEqual(out.map((m) => [m.start, m.title]), [[105, "B!"], [10, "t"], [200, "t"]]);
  assert.deepEqual(mergeRanked([], P, 2).map((m) => m.start), [10, 100], "no final call: best by score");
});

test("validateMoments scores a rubric reply as the mean of its criteria", () => {
  const m = validateMoments('[{"start":0,"end":30,"title":"x","scores":{"hook":10,"payoff":8,"context":6,"emotion":"?","quote":4,"ending":2}}]', { duration: 60, maxSec: 45, count: 3 });
  assert.equal(m[0].score, 0.6);
});

// words every 0.5 s over 0-8 s and 12-16 s of an 18 s clip
const talk: Word[] = [...Array.from({ length: 16 }, (_, i) => i * 0.5), ...Array.from({ length: 8 }, (_, i) => 12 + i * 0.5)].map((s) => ({ start: s, end: s + 0.4, text: "w" }));

test("keepSegments cuts quiet word gaps, keeping 0.15 s padding", () => {
  assert.deepEqual(r2(keepSegments(talk, flat(18), 18)), [[0, 8.05], [11.85, 16.05]]);
  assert.deepEqual(r2(keepSegments(talk, flat(18), 18, { minGap: 0.7, pad: 0.15, max: 1 })), [[0, 8.05], [11.85, 18]], "only the longest cut");
});

test("keepSegments keeps a loud moment inside a word gap", () => {
  const pts = flat(18).map((p) => (p.t > 9 && p.t < 10 ? { ...p, v: 1 } : p));
  assert.deepEqual(r2(keepSegments(talk, pts, 18)), [[0, 8.05], [8.85, 10.15], [11.85, 16.05]]);
});

test("keepSegments without words cuts quiet runs; never leaves under 5 s", () => {
  const pts = flat(12, 0.5).map((p) => (p.t > 4 && p.t < 6 ? { ...p, v: 0.01 } : p));
  assert.deepEqual(r2(keepSegments([], pts, 12)), [[0, 4.15], [5.85, 12]]);
  assert.deepEqual(keepSegments([], flat(6, 0), 6), [{ start: 0, end: 6 }]);
  assert.deepEqual(keepSegments([], [], 20), [{ start: 0, end: 20 }], "no audio: nothing to cut");
});

test("retime maps clip time onto the jump-cut timeline", () => {
  const segs = [{ start: 0, end: 2 }, { start: 4, end: 6 }, { start: 8, end: 10 }];
  assert.deepEqual([1, 3, 5, 7, 9, 11].map((t) => retime(t, segs)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(retimeWords([{ start: 3, end: 3.5, text: "cut" }, { start: 1.5, end: 4.5, text: "spans" }], segs), [{ start: 1.5, end: 2.5, text: "spans" }]);
});

test("zoomTimes picks the loudest peaks ≥ 6 s apart in kept parts, on the cut timeline", () => {
  const pts = flat(30).map((p) => ({ ...p, v: ({ 0.25: 1, 5.25: 1, 7.25: 0.9, 20.25: 0.8 } as Record<number, number>)[p.t] ?? 0.1 }));
  assert.deepEqual(zoomTimes(pts, [{ start: 0, end: 30 }]), [5.25, 20.25]);
  assert.deepEqual(zoomTimes(pts, [{ start: 0, end: 15 }, { start: 25, end: 30 }]), [5.25]);
  assert.deepEqual(zoomTimes(pts, [{ start: 2, end: 30 }]), [3.25, 18.25]);
  assert.deepEqual(zoomTimes(flat(10, 0), [{ start: 0, end: 10 }]), [], "silence: no zooms");
});

test("zoomExpr ramps 1 → 1.12 in 0.15 s, holds 1 s, ramps back", () => {
  const e = zoomExpr([3]);
  assert.equal(e, "1+0.12*(clip((on/30-2.85)/0.15,0,1)*clip((4.15-on/30)/0.15,0,1))");
  const z = (t: number) => new Function("on", "clip", `return ${e}`)(t * 30, (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))) as number;
  for (const [t, want] of [[2.8, 1], [2.925, 1.06], [3, 1.12], [3.9, 1.12], [4.075, 1.06], [4.2, 1]]) assert.ok(Math.abs(z(t) - want) < 1e-9, `z(${t})`);
});

test("markLoud flags caps, '!' and the loudest words", () => {
  const pts = flat(10).map((p) => (p.t === 2.25 ? { ...p, v: 1 } : p));
  const w = (text: string, start: number): Word => ({ text, start, end: start + 0.3 });
  assert.deepEqual(markLoud([w("I", 0), w("what", 2.1), w("OK", 5), w("no!", 6), w("Hello", 7)], pts).map((x) => x.loud), [false, true, true, true, false]);
});

test("renderFilter: cuts, audio, layouts, zooms", () => {
  const plain = renderFilter({ duration: 10 });
  assert.ok(!plain.includes("concat") && !plain.includes("[a]") && plain.endsWith("[lay]fps=30,format=yuv420p[v]"), plain);
  const cut = renderFilter({ duration: 10, audio: true, segs: [{ start: 0, end: 4 }, { start: 5, end: 9 }], ass: "c.ass" });
  for (const part of ["[0:v]fps=30,split=2[vs0][vs1]", "[vs1]trim=start=5:end=9,setpts=PTS-STARTPTS[vt1]", "[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[an]", "[an]asplit=2[as0][as1]",
    "[as1]atrim=start=5:end=9,asetpts=PTS-STARTPTS[at1]", "[vt0][at0][vt1][at1]concat=n=2:v=1:a=1[vc][ac]", "[vc]split=2[bg0][fg0]", ",ass=c.ass[v]",
    "[ac]anull[a]"]) assert.ok(cut.includes(part), part);
  assert.ok(renderFilter({ duration: 10, segs: [{ start: 1, end: 10 }] }).includes("split=1[vs0]"), "one part that skips the start still trims");
  assert.ok(renderFilter({ duration: 10, layout: "fill" }).includes("crop=1080:1920"));
  const split = renderFilter({ duration: 10, layout: "split", camSide: "left" });
  assert.ok(split.includes("vstack[lay]") && split.includes("crop=iw/3:ih:0:0") && split.includes("'iw/3+(iw*2/3-ow)/2'"));
  assert.ok(renderFilter({ duration: 10, layout: "split" }).includes("crop=iw/3:ih:iw*2/3:0"));
  assert.ok(renderFilter({ duration: 10, zooms: [3] }).includes("zoompan=z='1+0.12*(clip("));
  assert.ok(frameArgs("in.mp4", 1, "f.jpg", "fill").join(" ").includes("crop=1080:1920"));
});

test("spanCover and asrPieces seam ownership", async () => {
  const { spanCover, asrPieces } = await import("../src/lib/clips/pure.ts");
  const spans = [{ start: 0, end: 60 }, { start: 100, end: 160 }];
  assert.equal(spanCover({ start: 10, end: 40 }, spans), 1);
  assert.ok(Math.abs(spanCover({ start: 50, end: 110 }, spans) - 20 / 60) < 1e-9); // crosses an untranscribed gap
  assert.equal(spanCover({ start: 5, end: 5 }, spans), 0);
  const p = asrPieces([{ start: 0, end: 700 }], 300, 5);
  assert.deepEqual(p.map((x) => [x.from, x.start]), [[0, 0], [295, 300], [595, 600]]); // overlap read for context, ownership from `start`
});
