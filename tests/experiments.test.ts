import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_MIN, compareArms, judge, lessonTests, lessonsFrom, observation, versionOf, type Experiment } from "../src/lib/clips/experiments-pure.ts";
import { destinationProblem, mediaProblem, retryProblem } from "../src/lib/clips/handoff-pure.ts";
import { normText, reconcile } from "../src/lib/lessons-pure.ts";
import type { LearnRec } from "../src/lib/clips/learn-pure.ts";

const H = "a".repeat(64), H2 = "b".repeat(64);
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`;
const rec = (i: number, v48: number, extra: Partial<LearnRec> = {}): LearnRec => ({ videoId: vid(i), jobId: "j", clipId: `c${i}`, title: "t", hook: "h", reason: "",
  layout: "fit", captions: "none", durationSec: 25, sourceChannel: "x", kind: "other", publishedAt: "2026-10-01T00:00:00Z",
  snaps: { "48h": { at: "2026-10-03T00:00:00Z", views: v48, likes: 0, comments: 0 } }, ...extra });
const base = Array.from({ length: BASE_MIN }, (_, i) => rec(i, 100));
const exp = (n: number, lesson = "Cold opens beat slow intros"): Experiment => ({ id: `e${n}`, hypothesis: "cold open lifts views", lesson, jobId: "j", clipId: `x${n}`, at: "2026-10-01T00:00:00Z" });
const jobs = (n: number, pub: Record<string, unknown> = {}) => [{ id: "j", clips: Array.from({ length: n }, (_, i) => ({ id: `x${i}`, publish: { status: "done", videoId: vid(100 + i), mediaHash: H, at: "2026-10-01T00:00:00Z", ...pub } })) }] as never;

test("version: only a finished upload with the file's hash is the experiment's version", () => {
  assert.deepEqual(versionOf(exp(0), jobs(1)), { videoId: vid(100), mediaHash: H, publishedAt: "2026-10-01T00:00:00Z" });
  assert.equal(versionOf(exp(0), jobs(1, { mediaHash: undefined })), null);
  assert.equal(versionOf(exp(0), jobs(1, { status: "unknown" })), null);
  assert.equal(judge(exp(0), jobs(1, { status: "failed" }), base).verdict, "insufficient");
});

test("verdict thresholds: ≥1.5× supported, ≤1× not supported, between / too young / few comparables = insufficient", () => {
  const at = (v: number, recs = base) => judge(exp(0), jobs(1), [...recs, rec(100, v)]);
  assert.equal(at(150).verdict, "supported");
  assert.match(at(150).key, /supported/);
  assert.equal(at(100).verdict, "not-supported");
  assert.equal(at(120).verdict, "insufficient");
  assert.equal(at(500, base.slice(1)).key, "exp.fewBase");
  assert.equal(judge(exp(0), jobs(1), [...base, rec(100, 0, { snaps: {} })]).key, "exp.tooYoung");
});

test("baseline is like-for-like when enough exist, else any comparable", () => {
  const long = Array.from({ length: BASE_MIN }, (_, i) => rec(50 + i, 1000, { durationSec: 55 }));
  const r = judge(exp(0), jobs(1), [...base, ...long, rec(100, 150)]);
  assert.equal(r.likeForLike, true);
  assert.equal(r.baseline, 100);
  assert.equal(judge(exp(0), jobs(1), [...base.slice(1), ...long, rec(100, 150)]).likeForLike, false);
});

test("a lesson needs the sequential test to be sure: never from 1-4 Shorts, a clear lift over 5+ is proposed, no lift isn't", () => {
  // comparables: spread-out views (log-normal-ish), so the test has a real spread to work with
  const spread = [60, 80, 100, 125, 160];
  const base2 = spread.map((v, i) => rec(i, v));
  const lifted = (n: number, v: number) => [...base2, ...Array.from({ length: n }, (_, i) => rec(100 + i, v, { snaps: { "48h": { at: `2026-10-0${3 + (i % 5)}T00:00:00Z`, views: v, likes: 0, comments: 0 } } }))];
  const es = (n: number) => Array.from({ length: n }, (_, i) => exp(i));
  for (const n of [1, 2, 3, 4]) assert.deepEqual(lessonsFrom(es(n), jobs(n), lifted(n, 2000), 0), [], `${n} Shorts`);
  const ls = lessonsFrom(es(8), jobs(8), lifted(8, 2000), 0);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].support, 8);
  assert.ok(ls[0].confidence >= 0.95);
  assert.equal(reconcile([], ls, 0)[0].status, "proposed");
  assert.deepEqual(lessonsFrom(es(8), jobs(8), lifted(8, 100), 0), []); // the usual: no lesson
  const t = lessonTests(es(4), jobs(4), lifted(4, 2000)).get(normText("Cold opens beat slow intros"))!;
  assert.equal(t.decision.verdict, "early");
  assert.ok(Number.isFinite(t.decision.more!) && t.decision.more! >= 1);
});

test("a pair is shown, never judged alone; it feeds the lesson test with main − variant", () => {
  const two = [{ id: "j", clips: [0, 1].map((i) => ({ id: `x${i}`, publish: { status: "done", videoId: vid(100 + i), mediaHash: H, at: "2026-10-01T00:00:00Z" } })) }] as never;
  const e: Experiment = { ...exp(0), variants: [{ jobId: "j", clipId: "x1" }], window: "48h" };
  const recs = [...[60, 80, 100, 125, 160].map((v, i) => rec(i, v)), rec(100, 900), rec(101, 100)];
  const c = compareArms(e, two, recs);
  assert.equal(c.status, "read");
  assert.equal(c.ratio, 9);
  const o = observation(e, two, recs)!;
  assert.ok(Math.abs(o.x - Math.log(9)) < 1e-9);
  assert.equal(o.w, 2);
  assert.equal(compareArms(e, two, recs.slice(0, -1)).status, "waiting");
});

test("handoff: published media must hash the same as the reviewed media", () => {
  assert.equal(mediaProblem(H, H), "");
  assert.match(mediaProblem(H, H2), /changed since you approved/);
  assert.match(mediaProblem(undefined, H), /approve again/);
  assert.match(mediaProblem(H, undefined), /Couldn't read/);
});

test("handoff: an unknown outcome needs a channel lookup before any retry, forced or not", () => {
  assert.equal(retryProblem(undefined, false), "");
  assert.equal(retryProblem({ status: "failed" }, false), "");
  assert.match(retryProblem({ status: "unknown" }, true), /check YouTube/);
  assert.match(retryProblem({ status: "unknown", checkedAt: "2026-10-28T00:00:00Z" }, false), /check YouTube/);
  assert.equal(retryProblem({ status: "unknown", checkedAt: "2026-10-28T00:00:00Z" }, true), "");
});

test("handoff: destination check compares what YouTube has with what was sent", () => {
  const want = { videoId: vid(1), title: "My  Short", privacy: "public" };
  const item = (status: Record<string, unknown>, title = "My Short") => ({ items: [{ id: vid(1), snippet: { title }, status: { uploadStatus: "uploaded", ...status } }] });
  assert.equal(destinationProblem(want, item({ privacyStatus: "public" })), "");
  assert.match(destinationProblem(want, { items: [] }), /not found/);
  assert.match(destinationProblem(want, item({ privacyStatus: "private" })), /private on YouTube/);
  assert.match(destinationProblem(want, item({ privacyStatus: "public" }, "Other")), /title/);
  assert.match(destinationProblem(want, item({ privacyStatus: "public", uploadStatus: "rejected", rejectionReason: "duplicate" })), /rejected \(duplicate\)/);
  const sched = { ...want, privacy: "private", publishAt: "2026-10-30T18:00:00Z" };
  assert.equal(destinationProblem(sched, item({ privacyStatus: "private", publishAt: "2026-10-30T18:00:00.000Z" })), "");
  assert.match(destinationProblem(sched, item({ privacyStatus: "private" })), /schedule/);
});

test("store: add validates text, needs a published hashed clip, one experiment per Short", async () => {
  const { addExperiment, emptyExperiments, experimentsProblem } = await import("../src/lib/clips/experiments-pure.ts");
  const b = { hypothesis: " cold <open> ", lesson: "Cold opens win", jobId: "j", clipId: "x0" };
  const s = addExperiment(emptyExperiments(), b, jobs(1), "e1", "2026-10-28T00:00:00Z");
  assert.ok(typeof s !== "string" && s.items[0].hypothesis === "cold open");
  assert.equal(experimentsProblem(s), "");
  assert.match(addExperiment(s as never, b, jobs(1), "e2", "") as string, /already/);
  assert.match(addExperiment(emptyExperiments(), b, jobs(1, { mediaHash: undefined }), "e2", "") as string, /published/);
  assert.match(addExperiment(emptyExperiments(), { ...b, lesson: "" }, jobs(1), "e2", "") as string, /characters/);
});
