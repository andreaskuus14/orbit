import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_MIN, judge, lessonsFrom, versionOf, type Experiment } from "../src/lib/clips/experiments-pure.ts";
import { destinationProblem, mediaProblem, retryProblem } from "../src/lib/clips/handoff-pure.ts";
import { reconcile } from "../src/lib/lessons-pure.ts";
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

test("one supported Short never becomes a lesson; three do, as a proposal only", () => {
  const recs = [...base, ...[0, 1, 2].map((i) => rec(100 + i, 200))];
  const es = [exp(0), exp(1), exp(2)], rs = es.map((e) => judge(e, jobs(3), recs));
  assert.deepEqual(lessonsFrom(es.slice(0, 1), rs, 0), []);
  const ls = lessonsFrom(es, rs, 0);
  assert.equal(ls.length, 1);
  assert.equal(reconcile([], ls, 0)[0].status, "proposed");
  const mixed = [...rs.slice(0, 2), { ...rs[2], verdict: "not-supported" as const }];
  assert.deepEqual(lessonsFrom(es, mixed, 0), []); // 2 supported, 1 against: below LESSON_MIN
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
