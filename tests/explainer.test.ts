import { test } from "node:test";
import assert from "node:assert/strict";
import { actionProblem, approve, handoffPackage, ideaProgress, motionTestManifest, resetFromScript, stageOf, styleFramesManifest, validDraft, MOTION_SEC, type Idea } from "../src/lib/clips/explainer-pure.ts";
import { manifestProblems, totalFrames, FPS } from "../src/lib/clips/scene-manifest-pure.ts";

const T = "2026-11-21T10:00:00.000Z";
const draft = {
  topic: "What if the Moon left tonight", angle: "Hour by hour, from tides to nights",
  script: [{ seen: "Stickman looks up, the moon is gone", heard: "Tonight the Moon leaves.", sec: 4 }, { seen: "Waves go flat", heard: "First, the tides stop.", sec: 8 }, { seen: "Huge dark sky", heard: "Then nights get darker.", sec: 10 }, { seen: "Vote buttons", heard: "Calm or chaos?", sec: 4 }],
  storyboard: [{ shot: "wide", seen: "Stickman points up at the empty sky", heard: "Tonight the Moon leaves.", sec: 3, move: "push in" }, { shot: "close", seen: "Shocked face", heard: "Gone.", sec: 3, move: "hold" }, { shot: "odd", seen: "Flat sea", heard: "Tides stop.", sec: 4, move: "pan" }],
  titles: [{ text: "What if the Moon left tonight?", reason: "question + stakes" }, { text: "The Moon Disappeared", reason: "copy" }], thumbs: [{ idea: "Empty sky, one red arrow", reason: "one focal point" }], abNote: "Test 1 vs 2",
};
function idea(p: Partial<Idea> = {}): Idea {
  const d = validDraft(draft, ["the moon disappeared"]);
  assert.ok(typeof d !== "string");
  return { id: "abc123-def456", niche: "what if", why: { why: "Big stakes", copy: [], avoid: [] }, sources: [], createdAt: T, updatedAt: T, working: null, failed: null,
    styleFrames: null, styleApprovedAt: null, motionTest: null, motionApprovedAt: null, handoff: null, ...d, ...p };
}

test("validDraft: checks, copied titles dropped, shot fixed, length bounds", () => {
  const i = idea();
  assert.deepEqual(i.titles.map((t) => t.text), ["What if the Moon left tonight?"], "a copy of a source title is dropped");
  assert.equal(i.storyboard[2].shot, "medium");
  assert.match(String(validDraft({ ...draft, script: draft.script.slice(0, 2) })), /3 beats/);
  assert.match(String(validDraft({ ...draft, script: draft.script.map((b) => ({ ...b, sec: 1 })) })), /must be 20-60/);
  assert.match(String(validDraft({ ...draft, titles: [{ text: "The Moon Disappeared" }] }, ["The moon disappeared!"])), /no usable title/);
  assert.equal(typeof validDraft(null), "string");
});

test("the staged rule: style frames → his approval → motion test → his approval → hand-off", () => {
  let i = idea();
  assert.equal(stageOf(i), "style-frames");
  assert.match(actionProblem(i, "approve-style")!, /Make the style frames first/);
  assert.match(actionProblem(i, "make-motion-test")!, /Approve the style frames first/);
  assert.match(actionProblem(i, "handoff")!, /Approve the style frames and the motion test first/);
  i = { ...i, styleFrames: { files: ["a.png"], at: T } };
  assert.equal(actionProblem(i, "approve-style"), null);
  i = approve(i, "approve-style", T);
  assert.equal(stageOf(i), "motion-test");
  assert.match(actionProblem(i, "approve-motion")!, /Make the motion test first/);
  assert.match(actionProblem({ ...i, motionTest: { file: "m.mp4", sec: 12, at: T } }, "approve-motion")!, /5-8 s/);
  i = { ...i, motionTest: { file: "m.mp4", sec: 6, at: T } };
  assert.equal(actionProblem(i, "approve-motion"), null);
  assert.match(actionProblem(i, "handoff")!, /first/);
  i = approve(i, "approve-motion", T);
  assert.equal(stageOf(i), "handoff");
  assert.equal(actionProblem(i, "handoff"), null);
  i = { ...i, handoff: { file: "h.json", at: T } };
  assert.equal(stageOf(i), "review");
  assert.match(actionProblem(i, "handoff")!, /Already/);
  assert.match(actionProblem({ ...i, working: "x" }, "redo-script")!, /Still working/);
  assert.match(actionProblem({ ...i, dismissed: true }, "approve-style")!, /put away/);
});

test("a new script clears everything made from it, approvals included", () => {
  const i = resetFromScript(approve(approve(idea({ styleFrames: { files: ["a"], at: T }, motionTest: { file: "m", sec: 6, at: T } }), "approve-style", T), "approve-motion", T), T);
  assert.equal(i.styleApprovedAt, null); assert.equal(i.motionApprovedAt, null); assert.equal(i.script.length, 0);
  assert.equal(stageOf(i), "script");
});

test("render manifests pass STUDIO's manifest checks; the motion test is 5-8 s", () => {
  const i = idea();
  const s = styleFramesManifest(i);
  assert.deepEqual(manifestProblems(s), []); assert.equal(s.scenes.length, 3);
  const m = motionTestManifest(i), sec = totalFrames(m) / FPS;
  assert.deepEqual(manifestProblems(m), []);
  assert.ok(sec >= MOTION_SEC.min && sec <= MOTION_SEC.max, `motion test is ${sec} s`);
  const long = motionTestManifest(idea({ storyboard: i.storyboard.map((x) => ({ ...x, sec: 15 })) }));
  assert.equal(totalFrames(long) / FPS, MOTION_SEC.max);
  assert.deepEqual(manifestProblems(long), []);
  // acting: anticipation (wind-up) before the big pose
  assert.ok(m.scenes[0].acting.some((k) => k.pose === "wind-up"));
});

test("progress card: one card per idea, one button only when it needs him, never an upload", () => {
  let p = ideaProgress(idea({ working: "Drawing the style frames" }));
  assert.equal(p.phase, "working"); assert.equal(p.action, null); assert.equal(p.steps.filter((s) => s.state === "now").length, 1);
  p = ideaProgress(idea({ styleFrames: { files: ["a"], at: T } }));
  assert.equal(p.phase, "needs"); assert.equal(p.action?.kind, "approve"); assert.match(p.action!.label, /style frames/);
  assert.ok(p.steps.slice(0, 3).every((s) => s.state === "done"));
  p = ideaProgress(idea({ failed: "boom" }));
  assert.equal(p.phase, "failed"); assert.equal(p.action?.kind, "retry");
  const done = idea({ styleFrames: { files: ["a"], at: T }, styleApprovedAt: T, motionTest: { file: "m", sec: 6, at: T }, motionApprovedAt: T, handoff: { file: "h", at: T } });
  p = ideaProgress(done);
  assert.equal(p.phase, "done"); assert.match(p.result!.text, /Nothing was uploaded/);
  const h = handoffPackage(done);
  assert.equal(h.voice.voice, "af_heart"); assert.equal(h.phrases.length, 4);
  assert.ok(!/upload_url|publish_at|videoId/.test(JSON.stringify(h)));
});
