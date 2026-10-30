import { test } from "node:test";
import assert from "node:assert/strict";
import { capacity, liveIds, outcomeOf, REVIEW_MIN } from "../src/lib/clips/depth-pure.ts";
import { editChanges, paramHistory, renderEstimate, trimPreview } from "../src/lib/clips/edit-pure.ts";
import { addExperiment, compareArms, emptyExperiments, removalProblem, BASE_MIN, type Experiment } from "../src/lib/clips/experiments-pure.ts";
import { productionRecords } from "../src/lib/clips/production-pure.ts";
import { DEFAULT_PUBLISH } from "../src/lib/clips/schedule.ts";
import type { LearnRec } from "../src/lib/clips/learn-pure.ts";

const BASE = { layout: "fit", camSide: "right", captions: "karaoke", jumpCuts: true, zooms: true, coldOpen: false, progressBar: false, loopEnd: false } as const;
const H = "a".repeat(64);
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`;
const rec = (i: number, v: number, extra: Partial<LearnRec> = {}): LearnRec => ({ videoId: vid(i), jobId: "j", clipId: `c${i}`, title: "t", hook: "h", reason: "",
  layout: "fit", captions: "none", durationSec: 25, sourceChannel: "x", kind: "other", publishedAt: "2026-10-01T00:00:00Z",
  snaps: { "48h": { at: "2026-10-03T00:00:00Z", views: v, likes: 1, comments: 0, avgViewPct: 71.5, avgViewSec: 17.9 } }, ...extra });

test("STU05: parameter history lists what changed between consecutive renders; preview needs no render", () => {
  assert.deepEqual(editChanges(BASE as never, undefined, { captions: "none" }), [{ key: "captions", from: "karaoke", to: "none" }]);
  const h = paramHistory([{ clip: "clip-1-v3", title: "", status: "ready", edit: { ...BASE, layout: "fill", zooms: false } as never },
    { clip: "clip-1", title: "", status: "ready" }, { clip: "clip-1-v2", title: "", status: "ready", edit: { ...BASE, layout: "fill" } as never }], BASE as never);
  assert.deepEqual(h.map((r) => [r.n, r.changes.map((c) => c.key)]), [[1, []], [2, ["layout"]], [3, ["zooms"]]]);
  assert.deepEqual(trimPreview(30, 2, -3), { from: 2, to: 27, fragment: "#t=2.0,27.0", beyond: false });
  assert.equal(trimPreview(30, -2, 0).beyond, true, "earlier start needs frames the render lacks");
  assert.equal(renderEstimate({ timings: { audio: 1, transcribe: 1, pick: 1, render: 90 }, clips: [{ id: "a" }, { id: "b" }, { id: "b-v2", variantOf: "b" }] } as never), 45);
  assert.equal(renderEstimate({ clips: [{ id: "a" }] } as never), null);
});

const T = (iso: string) => Date.parse(iso);
const clip = (id: string, o: Record<string, unknown> = {}) => ({ id, start: 0, end: 30, title: id, hook: "", reason: "", score: 1, status: "approved", video: "clips/x.mp4",
  approvedHash: "x", approvedMedia: H, original: "my commentary on top", qc: { pass: true, media: H, blocking: [] }, ...o });
const job = (clips: object[], o: Record<string, unknown> = {}) => ({ v: 1, id: "j", source: "AI story: x", createdAt: "", updatedAt: "", status: "done", progress: 1, step: "", warnings: [],
  options: { count: 1, maxSec: 60, captions: true }, clips, ...o }) as never;

test("STU07: planned and confirmed are counted apart in Tallinn days; failed dependencies become exceptions", () => {
  const now = T("2026-10-16T06:00:00Z");
  const j = job([
    clip("a", { publish: { status: "scheduled", scheduledFor: "2026-10-16T05:00:00Z", videoId: vid(1), at: "x" } }), // due, seen live
    clip("b", { publish: { status: "scheduled", scheduledFor: "2026-10-16T05:30:00Z", videoId: vid(2), at: "x" } }), // due, not seen
    clip("c", { publish: { status: "scheduled", scheduledFor: "2026-10-17T14:00:00Z", videoId: vid(3), at: "x" }, qc: { pass: true, media: "other", blocking: [] } }), // planned but blocked
    clip("d", { publish: { status: "failed", error: "quota", at: "2026-10-16T04:00:00Z" } }),
    clip("e"), clip("f", { status: "ready" }), clip("g", { status: "rendering" }),
  ], { timings: { audio: 0, transcribe: 0, pick: 0, render: 700 } });
  const live = liveIds([rec(1, 40), rec(2, 0)]);
  assert.deepEqual([...live], [vid(1)]);
  const c = capacity(productionRecords([j]), [j], DEFAULT_PUBLISH, now, live);
  assert.equal(c.timezone, "Europe/Tallinn");
  assert.deepEqual([c.days[0].planned, c.days[0].confirmed], [1, 1]);
  assert.equal(c.days[1].planned, 1);
  assert.equal(c.readyToSchedule, 1, "only e: approved, checked, unscheduled");
  assert.equal(c.reviewMinutes, REVIEW_MIN);
  assert.deepEqual([c.rendering, c.renderMinutes], [1, 2]); // 700 s / 7 first-pass clips = 100 s
  assert.equal(c.gap, c.free - 1);
  assert.deepEqual(c.exceptions.map((x) => [x.id, x.why.split(":")[0]]), [["j:c", "Planned, but"], ["j:d", "Upload failed"]]);
  const later = capacity(productionRecords([j]), [j], DEFAULT_PUBLISH, T("2026-10-17T07:00:00Z"), live);
  assert.ok(later.exceptions.some((x) => x.id === "j:b" && /not confirmed/.test(x.why)), "a day overdue without a live reading");
  assert.ok(!later.exceptions.some((x) => x.id === "j:a"));
});

test("STU06: outcome joins the exact published revision, dated readings, honest limits", () => {
  const pub = { status: "done", videoId: vid(100), mediaHash: H, at: "2026-10-01T00:00:00Z" };
  assert.equal(outcomeOf({ id: "c", approvedMedia: H }, []), null);
  const few = outcomeOf({ id: "c", approvedMedia: H, publish: pub } as never, [rec(100, 300)])!;
  assert.equal(few.exact, true);
  assert.deepEqual(few.readings.map((r) => [r.snap, r.at, r.views, r.avgViewPct, r.avgViewSec]), [["48h", "2026-10-03T00:00:00Z", 300, 71.5, 17.9]]);
  assert.equal(few.vsUsual, undefined);
  assert.deepEqual(few.limits, ["oneShort", "noImpressions", "fewBase"]);
  const many = outcomeOf({ id: "c", approvedMedia: "other", publish: pub } as never, [rec(100, 300), ...Array.from({ length: BASE_MIN }, (_, i) => rec(i, 100))])!;
  assert.deepEqual(many.vsUsual, { ratio: 3, snap: "48h", n: BASE_MIN, likeForLike: true });
  assert.ok(many.limits.includes("notExact"));
  assert.ok(outcomeOf({ id: "c", publish: { ...pub, status: "done" } } as never, [])!.limits.includes("noReading"));
});

const pubJobs = (n: number) => [{ id: "j", clips: Array.from({ length: n }, (_, i) => ({ id: `x${i}`, publish: { status: "done", videoId: vid(100 + i), mediaHash: H, at: "2026-10-01T00:00:00Z" } })) }] as never;
test("STU08: variants are compared at one fixed window, waiting until every arm has it; failures are kept", () => {
  const b = { hypothesis: "cold open", lesson: "Cold opens win", jobId: "j", clipId: "x0", variants: [{ jobId: "j", clipId: "x1" }], window: "48h" };
  const s = addExperiment(emptyExperiments(), b, pubJobs(2), "e1", "t");
  assert.ok(typeof s !== "string" && s.items[0].window === "48h" && s.items[0].variants?.length === 1);
  assert.match(addExperiment(emptyExperiments(), { ...b, window: "1y" }, pubJobs(2), "e1", "t") as string, /window/);
  assert.match(addExperiment(emptyExperiments(), { ...b, variants: [{ jobId: "j", clipId: "x0" }] }, pubJobs(2), "e1", "t") as string, /different/);
  assert.match(addExperiment(emptyExperiments(), { ...b, variants: [{ jobId: "j", clipId: "x9" }] }, pubJobs(2), "e1", "t") as string, /published/);
  const e = (s as { items: Experiment[] }).items[0];
  assert.equal(compareArms(e, pubJobs(2), [rec(100, 300)]).status, "waiting");
  const r = compareArms(e, pubJobs(2), [rec(100, 300), rec(101, 100)]);
  assert.deepEqual([r.status, r.ratio, r.arms[0].readAt], ["differs", 3, "2026-10-03T00:00:00Z"]);
  assert.equal(compareArms(e, pubJobs(2), [rec(100, 120), rec(101, 100)]).status, "similar");
  assert.equal(compareArms({ ...e, window: "7d" }, pubJobs(2), [rec(100, 300), rec(101, 100)]).status, "waiting", "no peeking at another window");
  assert.match(removalProblem({ verdict: "not-supported" }), /kept/);
  assert.equal(removalProblem({ verdict: "insufficient" }), "");
});
