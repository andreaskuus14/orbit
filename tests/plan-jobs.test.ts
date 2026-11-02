import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, applyTask, markStarted, newPlanJob, nextAction, parsePlanJob, progressLine, retryFailed, stepRequest, type PlanJob } from "../src/lib/plan-jobs-pure.ts";

const now = Date.parse("2026-11-02T22:00:00Z");
const mk = () => newPlanJob({ title: "Shop research", agent: "atlas", goal: "Find a niche", steps: "1. List 10 niches\n- Score them\n\nPick one", night: true }, "job1", now) as PlanJob;

test("newPlanJob validates and strips list markers", () => {
  const j = mk();
  assert.deepEqual(j.steps.map((s) => s.text), ["List 10 niches", "Score them", "Pick one"]);
  assert.equal(j.night, true);
  assert.equal(newPlanJob({ title: "x", agent: "atlas", steps: "a step" }, "i", now), "Give the job a title");
  assert.equal(newPlanJob({ title: "Title", agent: "Bad Agent", steps: "a step" }, "i", now), "Unknown agent");
  assert.equal(newPlanJob({ title: "Title", agent: "atlas", steps: "" }, "i", now), "Add at least one step (one per line)");
  assert.match(String(newPlanJob({ title: "Title", agent: "atlas", steps: Array(MAX_STEPS + 1).fill("step") }, "i", now)), /At most/);
  assert.deepEqual(parsePlanJob(JSON.parse(JSON.stringify(j))), j);
  assert.equal(parsePlanJob({ id: "../x", title: "t", agent: "a", steps: [] }), null);
});

test("one step at a time: start, check, done, resume at the next; a failed step pauses until Retry", () => {
  const j = mk();
  let n = nextAction(j);
  assert.equal(n.act, "start");
  markStarted(j, "s1", "task-1", now);
  n = nextAction(j);
  assert.equal(n.act === "check" && n.step.task, "task-1");
  applyTask(j, "s1", { status: "awaiting_approval" }, now); // still in flight
  assert.equal(j.steps[0].status, "doing");
  applyTask(j, "s1", { status: "done", result: "Found them.\nPROGRESS: 10 niches listed" }, now);
  assert.equal(j.steps[0].note, "10 niches listed");
  n = nextAction(j);
  assert.equal(n.act === "start" && n.step.id, "s2");
  markStarted(j, "s2", "task-2", now);
  applyTask(j, "s2", { status: "failed", error: "Budget exceeded" }, now);
  assert.deepEqual(nextAction(j), { act: "none" });
  assert.equal(retryFailed(j, now), true);
  assert.equal(nextAction(j).act, "start");
  markStarted(j, "s2", "task-3", now); applyTask(j, "s2", { status: "done", result: "ok" }, now);
  markStarted(j, "s3", "task-4", now); applyTask(j, "s3", null, now); // row gone
  assert.equal(j.steps[2].status, "failed");
  retryFailed(j, now); markStarted(j, "s3", "task-5", now); applyTask(j, "s3", { status: "done", result: "Picked" }, now);
  assert.equal(j.status, "done");
  assert.ok(j.progress.some((p) => p.includes("All steps done")));
  j.status = "paused";
  assert.deepEqual(nextAction(j), { act: "none" });
});

test("stepRequest: plan + progress first, only this step, approvals rule, idem marker", () => {
  const j = mk();
  markStarted(j, "s1", "t", now); applyTask(j, "s1", { status: "done", result: "PROGRESS: listed" }, now);
  const r = stepRequest(j, j.steps[1], "orbit-abc");
  assert.match(r, /step 2 of 3/);
  assert.match(r, /1\. \[x\] List 10 niches \(listed\)/);
  assert.match(r, /2\. \[>\] Score them/);
  assert.match(r, /DO ONLY STEP 2: Score them/);
  assert.match(r, /PROGRESS SO FAR/);
  assert.match(r, /waits for the owner's click/);
  assert.ok(r.endsWith("[orbit-abc]"));
  assert.equal(progressLine("**Done**\nmore"), "Done");
});
