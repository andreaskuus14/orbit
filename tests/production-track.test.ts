// Y2: the Production track state machine (track-pure.ts). Generation is faked; nothing spends or renders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, approve, approvedFrames, artifactContent, cachedSha, fullVideoProblem, generate, newTrack, reopenChanged, revise, STAGES, submit, summary, trackProblem, useFrameProblem, type Track } from "../src/lib/clips/track-pure.ts";
import { contentHash } from "../src/lib/approval-pure.ts";

const AT = "2026-11-11T10:00:00Z";
const h = (s: Parameters<typeof artifactContent>[0], a: Parameters<typeof artifactContent>[1]) => contentHash(artifactContent(s, a));
async function toStyle(): Promise<Track> {
  const t = newTrack("t1", "Fox", AT);
  for (const s of ["references", "script", "storyboard"] as const) { assert.equal(submit(t, s, { ref: `vault/${s}.md`, sha: "s0" }, AT), ""); assert.equal(await advance(t), ""); }
  assert.equal(STAGES[t.stage].id, "style");
  return t;
}
async function toMotionApproved(): Promise<Track> {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png", sha: "s0" }, AT);
  assert.equal(await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png", sha: "s0" }), AT), "");
  assert.equal(await advance(t), "");
  submit(t, "motion", { ref: "renders/test.mp4", sha: "s0", sec: 6 }, AT);
  assert.equal(await approve(t, "motion", "renders/test.mp4", await h("motion", { ref: "renders/test.mp4", sha: "s0", sec: 6 }), AT), "");
  return t;
}
// Stand-in for approveStory: refuses like its guards would (here: anything but the hash of the quote he saw), counts real spends.
const fakeGen = (quoteHash = "q1", guard = "") => { let calls = 0; return { gen: async (seen: string) => { if (guard) return guard; if (seen !== quoteHash) return "The content changed since you approved it"; calls++; return { jobs: ["fake"] }; }, calls: () => calls }; };

test("stages: eight, in his order; 4 and 5 always owner-gated", () => {
  assert.deepEqual(STAGES.map((s) => s.id), ["references", "script", "storyboard", "style", "motion", "animation", "sound", "render"]);
  assert.equal(STAGES[3].gate, "owner"); assert.equal(STAGES[4].gate, "owner");
  for (const s of STAGES) assert.ok(s.inputs && s.output && s.gate);
});

test("style frames: never used, never passed, until he approves that exact frame", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png", sha: "s0" }, AT);
  assert.match(await useFrameProblem(t, "frames/a.png"), /isn't approved/);
  assert.match(await advance(t), /approve a style frame/);
  assert.match(await approve(t, "style", "frames/a.png", "wrong", AT), /changed/);
  assert.equal(await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png", sha: "s0" }), AT), "");
  assert.equal(await useFrameProblem(t, "frames/a.png"), "");
  submit(t, "style", { ref: "frames/a.png", sha: "s0", note: "warmer" }, AT); // re-submitted = changed = unapproved
  assert.match(await useFrameProblem(t, "frames/a.png"), /isn't approved/);
});

test("full video can never start before the motion test is approved", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png", sha: "s0" }, AT);
  await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png", sha: "s0" }), AT);
  assert.equal(await advance(t), "");
  assert.match(submit(t, "motion", { ref: "renders/test.mp4", sha: "s0", sec: 20 }, AT), /5-8/);
  assert.match(submit(t, "animation", { ref: "renders/full.mp4", sha: "s0" }, AT), /Finish Motion test/);
  submit(t, "motion", { ref: "renders/test.mp4", sha: "s0", sec: 6 }, AT);
  assert.match(await advance(t), /approve the motion test/);
  t.stage = 5; // even a forced stage can't start it
  assert.match(await fullVideoProblem(t), /motion test isn't approved/);
  const f = fakeGen();
  assert.match(JSON.stringify(await generate(t, "animation", "q1", ["frames/a.png"], f.gen)), /motion test isn't approved/);
  assert.equal(f.calls(), 0);
});

test("generation: only approved frames, goes through the approveStory guards, and a hash pays once (fake generator)", async () => {
  const t = await toMotionApproved();
  assert.equal(await advance(t), "");
  const f = fakeGen();
  assert.match(JSON.stringify(await generate(t, "animation", undefined, ["frames/a.png"], f.gen)), /approval/);
  assert.match(JSON.stringify(await generate(t, "animation", "wrong", ["frames/a.png"], f.gen)), /changed/);
  assert.match(JSON.stringify(await generate(t, "animation", "q1", ["frames/a.png"], fakeGen("q1", "Stop-all is on").gen)), /Stop-all/);
  assert.match(JSON.stringify(await generate(t, "animation", "q1", ["frames/zzz.png"], f.gen)), /Unknown style frame/);
  assert.equal(f.calls(), 0);
  assert.deepEqual(await generate(t, "animation", "q1", ["frames/a.png"], f.gen), { ok: { jobs: ["fake"] } });
  assert.match(JSON.stringify(await generate(t, "animation", "q1", ["frames/a.png"], f.gen)), /already used/);
  assert.equal(f.calls(), 1);
});

test("approval is tied to the file's content: a changed sha or a non-file can't be approved or stay approved", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "https://example.com/x.png", sha: "" }, AT);
  assert.match(await approve(t, "style", "https://example.com/x.png", await h("style", { ref: "https://example.com/x.png", sha: "" }), AT), /Only a file/);
  submit(t, "style", { ref: "frames/a.png", sha: "s0" }, AT);
  assert.equal(await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png", sha: "s0" }), AT), "");
  t.frames.find((f) => f.ref === "frames/a.png")!.sha = "edited-on-disk"; // what refreshShas does after an edit
  assert.match(await useFrameProblem(t, "frames/a.png"), /isn't approved/);
});

test("upstream resubmit clears this and every later approval and reopens there (incl. a style frame at stage 8)", async () => {
  const t = await toMotionApproved();
  await advance(t);
  for (const s of ["animation", "sound"] as const) { submit(t, s, { ref: `renders/${s}.mp4`, sha: "s0" }, AT); await advance(t); }
  submit(t, "render", { ref: "renders/final.mp4", sha: "s0" }, AT);
  assert.equal(await approve(t, "render", "renders/final.mp4", await h("render", { ref: "renders/final.mp4", sha: "s0" }), AT), "");
  submit(t, "style", { ref: "frames/b.png", sha: "s0" }, AT);
  assert.equal(STAGES[t.stage].id, "style");
  assert.ok(!t.out.motion?.approved && !t.out.render?.approved);
  assert.deepEqual(t.frames.map((f) => !!f.approved), [true, false]); // other frames keep their approval
  assert.match(await fullVideoProblem(t), /motion test/);
  const u = await toMotionApproved(); // a script change also drops the motion test approval
  submit(u, "script", { ref: "vault/script2.md", sha: "s0" }, AT);
  assert.equal(STAGES[u.stage].id, "script"); assert.ok(!u.out.motion?.approved && !u.frames.some((f) => f.approved));
});

test("render can't be approved without an approved style frame", async () => {
  const t = await toMotionApproved();
  await advance(t);
  for (const s of ["animation", "sound"] as const) { submit(t, s, { ref: `renders/${s}.mp4`, sha: "s0" }, AT); await advance(t); }
  submit(t, "render", { ref: "renders/final.mp4", sha: "s0" }, AT);
  t.frames[0].sha = "changed"; // frame edited on disk without a resubmit
  assert.match(await approve(t, "render", "renders/final.mp4", await h("render", { ref: "renders/final.mp4", sha: "s0" }), AT), /No approved style frame/);
});

test("redoing the motion test re-opens it and drops its approval", async () => {
  const t = await toMotionApproved();
  assert.equal(await advance(t), "");
  submit(t, "motion", { ref: "renders/test2.mp4", sha: "s0", sec: 7 }, AT);
  assert.equal(STAGES[t.stage].id, "motion");
  assert.match(await fullVideoProblem(t), /motion test/);
});

test("review: render waits for him; revise goes back to animation, keeps approvals; summary lists waiting items", async () => {
  const t = await toMotionApproved();
  await advance(t);
  for (const s of ["animation", "sound"] as const) { submit(t, s, { ref: `renders/${s}.mp4`, sha: "s0" }, AT); assert.equal(await advance(t), ""); }
  submit(t, "render", { ref: "renders/final.mp4", sha: "s0" }, AT);
  const s = await summary(t);
  assert.equal(s.current, "render");
  assert.deepEqual(s.waiting.map((w) => w.stage), ["render"]);
  assert.equal(revise(t), "");
  assert.equal(STAGES[t.stage].id, "animation"); assert.equal(t.revisions, 1);
  assert.equal(await fullVideoProblem(t), "");
  assert.equal(trackProblem(t, "t1"), ""); assert.equal(trackProblem({}, "t1"), "bad track");
});

test("approve: refused for a stage the track hasn't reached", async () => {
  const t = await toStyle();
  t.out.render = { ref: "renders/final.mp4", sha: "s0", at: AT };
  assert.match(await approve(t, "render", "renders/final.mp4", await h("render", { ref: "renders/final.mp4", sha: "s0" }), AT), /Finish Style frames first/);
  assert.equal(t.out.render.approved, undefined);
});

test("a frame or motion test changed on disk after a later stage: track reopens there", async () => {
  const t = await toMotionApproved();
  assert.equal(await advance(t), "");
  assert.equal(await reopenChanged(t), false);
  t.out.motion!.sha = "s1"; // refreshShas saw a new file
  assert.equal(await reopenChanged(t), true);
  assert.equal(STAGES[t.stage].id, "motion");
  assert.equal(t.out.motion!.approved, undefined);
  const u = await toMotionApproved();
  assert.equal(await advance(u), "");
  u.frames[0].sha = "s1";
  assert.equal(await reopenChanged(u), true);
  assert.equal(STAGES[u.stage].id, "style");
  assert.equal(u.out.motion!.approved, undefined);
  assert.match(await advance(u), /approve a style frame/);
  assert.equal(await reopenChanged(u), false);
});

test("generate motion test needs an approved style frame", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png", sha: "s0" }, AT);
  t.stage = STAGES.findIndex((s) => s.id === "motion");
  const g = fakeGen();
  assert.deepEqual(await generate(t, "motion", "q1", [], g.gen), { error: "No approved style frame: approve one first" });
  assert.equal(g.calls(), 0);
});

test("adding a style frame keeps the other frames approved", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png", sha: "s0" }, AT);
  await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png", sha: "s0" }), AT);
  submit(t, "style", { ref: "frames/b.png", sha: "s0" }, AT);
  assert.deepEqual((await approvedFrames(t)).map((f) => f.ref), ["frames/a.png"]);
});

test("sha cache: re-hashes only when mtime or size changes", async () => {
  const c = new Map(); let n = 0; const hash = async () => `h${++n}`;
  assert.equal(await cachedSha(c, "f", { mtimeMs: 1, size: 10 }, hash), "h1");
  assert.equal(await cachedSha(c, "f", { mtimeMs: 1, size: 10 }, hash), "h1");
  assert.equal(await cachedSha(c, "f", { mtimeMs: 2, size: 10 }, hash), "h2");
  assert.equal(await cachedSha(c, "f", { mtimeMs: 2, size: 11 }, hash), "h3");
  assert.equal(await cachedSha(c, "f", null, hash), ""); assert.equal(c.size, 0);
});
