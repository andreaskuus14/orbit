import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyHookLab, firstWordShift, hookLabPlan, hookLabProblem, hookPrior, labOutcomes, rankHookLab, recordOutcomes, scoreVariant, type Variant } from "../src/lib/clips/hooklab-pure.ts";
import { baseEdit, type Analysis } from "../src/lib/clips/pure.ts";
import type { LearnRec } from "../src/lib/clips/learn-pure.ts";
import type { Clip, ClipJob } from "../src/lib/clips/types.ts";

const edit = { ...baseEdit({ count: 1, maxSec: 30, captions: true }), jumpCuts: false, zooms: false };
// 20 s clip at 0.5 s windows: quiet first second, loud peak at 10 s; words from 1.2 s on
const rms = Array.from({ length: 40 }, (_, i) => (i < 2 ? 0.01 : i === 20 ? 1 : 0.2));
const words = [1.2, 1.6, 2.4, 3, 10, 10.4].map((s, i) => ({ start: s, end: s + 0.3, text: `w${i}` }));
const a: Analysis = { v: 1, duration: 20, hasAudio: true, spans: [], words, rms, cands: [], moments: [] };
const v = (p: Partial<Variant>): Variant => ({ id: "clip-1-v2", label: "A", pattern: "cold-open", hook: "Watch this", start: 0, end: 20, edit, ...p });
const rec = (n: number, views: number, hook: string): LearnRec => ({ videoId: `vid${String(n).padStart(8, "0")}`, jobId: "j", clipId: `clip-${n}`, title: "t", hook, reason: "",
  layout: "fit", captions: "none", durationSec: 20, sourceChannel: "o", kind: "other", snaps: { "48h": { at: "2026-10-20T00:00:00Z", views, likes: 0, comments: 0 } } });

test("plan: A cold open, B starts on the first word 1..2 s in, C takes the best unused title and asks for a new hook", () => {
  const c = { id: "clip-1", start: 0, end: 20, title: "Now", titleOptions: [{ text: "Now", score: 9 }, { text: "Better", score: 8 }, { text: "Ok", score: 2 }] } as Clip;
  const [A, B, C] = hookLabPlan(c, a);
  assert.deepEqual(A.req.edit, { coldOpen: true });
  assert.equal(B.req.dStart, 1.55); // opening peak at 1.25 s: the word at 1.6 s, not the one at 1.2 s
  assert.equal(C.req.title, "Better");
  assert.equal(C.req.suggest, true);
  assert.equal(firstWordShift({ ...a, words: [] }, c), 1); // no speech: still 1 s in
});

test("scorer: cold open scores its loud first second, more early words score higher, prior moves the hook part", () => {
  const p = hookPrior([]), lab = emptyHookLab();
  const A = scoreVariant(v({ edit: { ...edit, coldOpen: true } }), a, p, lab), B = scoreVariant(v({ pattern: "first-word", edit }), a, p, lab);
  assert.ok(A.parts.loud > B.parts.loud);
  assert.equal(A.parts.hook, 0.5); // no data: neutral
  const shifted = scoreVariant(v({ pattern: "first-word", start: 1.15 }), a, p, lab);
  assert.ok(shifted.parts.words > B.parts.words);
  const prior = hookPrior([rec(1, 100, "Why?"), rec(2, 200, "Who?"), rec(3, 10, "plain words"), rec(4, 300, "How?")]);
  assert.ok(scoreVariant(v({ hook: "Really?" }), a, prior, lab).parts.hook > scoreVariant(v({ hook: "plain one" }), a, prior, lab).parts.hook);
});

test("rank: best first with a reason naming the runner-up", () => {
  const r = rankHookLab([v({ id: "b", label: "B", pattern: "first-word" }), v({ id: "a", edit: { ...edit, coldOpen: true } })], a, hookPrior([]), emptyHookLab());
  assert.equal(r.winner, "a");
  assert.match(r.why, /^A .* leads B by \d+ pts: louder first second/);
  assert.equal(rankHookLab([], a, hookPrior([]), emptyHookLab()).winner, undefined);
});

test("prior update: each published variant's 48 h verdict counts once and raises its pattern's rate", () => {
  const clip = (id: string, vid: string, pattern: "cold-open" | "new-hook") => ({ id, start: 0, end: 20, title: "", hook: "", reason: "", score: 0, status: "approved",
    publish: { status: "done", videoId: vid, at: "" }, hookLab: { of: "clip-1", label: "A", pattern, at: "" } }) as Clip;
  const jobs = [{ clips: [clip("clip-1-v2", "vid00000001", "cold-open"), clip("clip-1-v3", "vid00000003", "new-hook"), { ...clip("x", "vid00000002", "cold-open"), hookLab: undefined }] }] as unknown as ClipJob[];
  const recs = [rec(1, 500, "a"), rec(2, 100, "b"), rec(3, 10, "c")];
  const outs = labOutcomes(jobs, recs);
  assert.deepEqual(outs.map((o) => [o.pattern, o.verdict]), [["cold-open", "worked"], ["new-hook", "flopped"]]);
  const s1 = recordOutcomes(emptyHookLab(), outs);
  assert.deepEqual(s1.patterns["cold-open"], { worked: 1, flopped: 0 });
  assert.deepEqual(s1.patterns["new-hook"], { worked: 0, flopped: 1 });
  assert.equal(recordOutcomes(s1, outs), s1); // nothing new: same object, no write
  assert.equal(hookLabProblem(s1), "");
  assert.notEqual(hookLabProblem({ v: 1, patterns: {}, counted: [] }), "");
  const B = scoreVariant(v({}), a, hookPrior([]), s1), C = scoreVariant(v({ pattern: "new-hook" }), a, hookPrior([]), s1);
  assert.ok(B.parts.pattern > C.parts.pattern);
});
