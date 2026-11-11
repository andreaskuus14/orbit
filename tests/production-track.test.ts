// Y2: the Production track state machine (track-pure.ts). Generation is faked; nothing spends or renders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, approve, artifactContent, fullVideoProblem, generate, newTrack, revise, STAGES, submit, summary, trackProblem, useFrameProblem, type Track } from "../src/lib/clips/track-pure.ts";
import { contentHash, spendContent } from "../src/lib/approval-pure.ts";

const AT = "2026-11-11T10:00:00Z";
const h = (s: Parameters<typeof artifactContent>[0], a: Parameters<typeof artifactContent>[1]) => contentHash(artifactContent(s, a));
async function toStyle(): Promise<Track> {
  const t = newTrack("t1", "Fox", AT);
  for (const s of ["references", "script", "storyboard"] as const) { assert.equal(submit(t, s, { ref: `vault/${s}.md` }, AT), ""); assert.equal(await advance(t), ""); }
  assert.equal(STAGES[t.stage].id, "style");
  return t;
}
async function toMotionApproved(): Promise<Track> {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png" }, AT);
  assert.equal(await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png" }), AT), "");
  assert.equal(await advance(t), "");
  submit(t, "motion", { ref: "renders/test.mp4", sec: 6 }, AT);
  assert.equal(await approve(t, "motion", "renders/test.mp4", await h("motion", { ref: "renders/test.mp4", sec: 6 }), AT), "");
  return t;
}
const fakeGen = () => { let calls = 0; return { gen: async () => { calls++; return { jobs: ["fake"] }; }, calls: () => calls }; };

test("stages: eight, in his order; 4 and 5 always owner-gated", () => {
  assert.deepEqual(STAGES.map((s) => s.id), ["references", "script", "storyboard", "style", "motion", "animation", "sound", "render"]);
  assert.equal(STAGES[3].gate, "owner"); assert.equal(STAGES[4].gate, "owner");
  for (const s of STAGES) assert.ok(s.inputs && s.output && s.gate);
});

test("style frames: never used, never passed, until he approves that exact frame", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png" }, AT);
  assert.match(await useFrameProblem(t, "frames/a.png"), /isn't approved/);
  assert.match(await advance(t), /approve a style frame/);
  assert.match(await approve(t, "style", "frames/a.png", "wrong", AT), /changed/);
  assert.equal(await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png" }), AT), "");
  assert.equal(await useFrameProblem(t, "frames/a.png"), "");
  submit(t, "style", { ref: "frames/a.png", note: "warmer" }, AT); // re-submitted = changed = unapproved
  assert.match(await useFrameProblem(t, "frames/a.png"), /isn't approved/);
});

test("full video can never start before the motion test is approved", async () => {
  const t = await toStyle();
  submit(t, "style", { ref: "frames/a.png" }, AT);
  await approve(t, "style", "frames/a.png", await h("style", { ref: "frames/a.png" }), AT);
  assert.equal(await advance(t), "");
  assert.match(submit(t, "motion", { ref: "renders/test.mp4", sec: 20 }, AT), /5-8/);
  assert.match(submit(t, "animation", { ref: "renders/full.mp4" }, AT), /Finish Motion test/);
  submit(t, "motion", { ref: "renders/test.mp4", sec: 6 }, AT);
  assert.match(await advance(t), /approve the motion test/);
  t.stage = 5; // even a forced stage can't start it
  assert.match(await fullVideoProblem(t), /motion test isn't approved/);
  const f = fakeGen(), fp = "fp1", hash = await contentHash(spendContent(fp, 4));
  assert.match(JSON.stringify(await generate(t, "animation", fp, 4, hash, ["frames/a.png"], f.gen)), /motion test isn't approved/);
  assert.equal(f.calls(), 0);
});

test("generation: needs story.approve hash of these exact credits and only approved frames (fake generator)", async () => {
  const t = await toMotionApproved();
  assert.equal(await advance(t), "");
  const f = fakeGen(), fp = "fp1";
  assert.match(JSON.stringify(await generate(t, "animation", fp, 4, undefined, ["frames/a.png"], f.gen)), /approval/);
  assert.match(JSON.stringify(await generate(t, "animation", fp, 4, await contentHash(spendContent(fp, 3)), ["frames/a.png"], f.gen)), /changed/);
  submit(t, "style", { ref: "frames/b.png" }, AT);
  assert.match(JSON.stringify(await generate(t, "animation", fp, 4, await contentHash(spendContent(fp, 4)), ["frames/b.png"], f.gen)), /isn't approved/);
  assert.equal(f.calls(), 0);
  assert.deepEqual(await generate(t, "animation", fp, 4, await contentHash(spendContent(fp, 4)), ["frames/a.png"], f.gen), { jobs: ["fake"] });
  assert.equal(f.calls(), 1);
});

test("redoing the motion test re-opens it and drops its approval", async () => {
  const t = await toMotionApproved();
  assert.equal(await advance(t), "");
  submit(t, "motion", { ref: "renders/test2.mp4", sec: 7 }, AT);
  assert.equal(STAGES[t.stage].id, "motion");
  assert.match(await fullVideoProblem(t), /motion test/);
});

test("review: render waits for him; revise goes back to animation, keeps approvals; summary lists waiting items", async () => {
  const t = await toMotionApproved();
  await advance(t);
  for (const s of ["animation", "sound"] as const) { submit(t, s, { ref: `renders/${s}.mp4` }, AT); assert.equal(await advance(t), ""); }
  submit(t, "render", { ref: "renders/final.mp4" }, AT);
  const s = await summary(t);
  assert.equal(s.current, "render");
  assert.deepEqual(s.waiting.map((w) => w.stage), ["render"]);
  assert.equal(revise(t), "");
  assert.equal(STAGES[t.stage].id, "animation"); assert.equal(t.revisions, 1);
  assert.equal(await fullVideoProblem(t), "");
  assert.equal(trackProblem(t, "t1"), ""); assert.equal(trackProblem({}, "t1"), "bad track");
});
