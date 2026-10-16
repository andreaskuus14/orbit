import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelPlan, confirmStep, nextMove, pickBest, plansProblem, progressLine, validatePlan, type Plan } from "../src/lib/plans-pure.ts";
import { actionBlocked } from "../src/lib/core-studio.ts";

const full = { goal: "5 shorts, schedule best 3", steps: [{ type: "clip", source: "latest", count: 5 }, { type: "wait" }, { type: "pick_best", n: 3 }, { type: "approve" }, { type: "schedule" }] };
const plan = (o: Partial<Plan> = {}): Plan => {
  const v = validatePlan(full);
  if (typeof v === "string") throw new Error(v);
  return { id: "p", goal: v.goal, createdAt: "", updatedAt: "", status: "running", current: 0, steps: v.steps, ...o };
};

test("validate: the full plan", () => {
  const v = validatePlan(full);
  assert.ok(typeof v !== "string");
  assert.deepEqual(v.steps.map((s) => s.type), ["clip", "wait", "pick_best", "approve", "schedule"]);
  assert.deepEqual(v.steps[0].args, { source: "latest", count: 5 });
});

test("validate: adds the missing wait; rejects bad order, unknown steps, bad args and dependencies", () => {
  const v = validatePlan({ steps: [{ type: "clip" }, { type: "pick_best", n: 2 }] });
  assert.ok(typeof v !== "string");
  assert.deepEqual(v.steps.map((s) => s.type), ["clip", "wait", "pick_best"]);
  assert.equal(v.goal, "Clip plan");
  assert.match(validatePlan({ steps: [{ type: "clip" }, { type: "approve" }, { type: "pick_best", n: 1 }] }) as string, /order/);
  assert.match(validatePlan({ steps: [{ type: "clip" }, { type: "publish_now" }] }) as string, /unknown step/);
  assert.match(validatePlan({ steps: [{ type: "schedule" }] }) as string, /starts with a clip/);
  assert.match(validatePlan({ steps: [{ type: "clip" }, { type: "pick_best", n: 2 }, { type: "schedule" }] }) as string, /approve first/);
  assert.match(validatePlan({ steps: [{ type: "clip" }, { type: "approve" }] }) as string, /pick_best/);
  assert.match(validatePlan({ steps: [{ type: "clip", count: 2 }, { type: "pick_best", n: 3 }] }) as string, /more than the 2/);
  assert.match(validatePlan({ steps: [{ type: "clip", source: "../secret.mp4" }] }) as string, /source/);
  assert.match(validatePlan({ steps: [{ type: "clip", count: 50 }] }) as string, /count/);
  assert.match(validatePlan({ steps: [] }) as string, /1-5/);
  assert.match(validatePlan(null) as string, /1-5/);
  assert.ok(typeof validatePlan({ steps: [{ type: "clip", source: "stream 2026-10-16.mp4", maxSec: 40, layout: "split" }] }) !== "string");
});

test("confirmation gate: schedule pauses until the owner's OK for that exact step", () => {
  const p = plan({ current: 4 });
  assert.equal(nextMove(p), "wait_ok");
  assert.match(confirmStep(p, 4), /isn't waiting/); // the runner must have paused it first
  p.status = "waiting";
  assert.match(confirmStep(p, 3), /doesn't need/);
  assert.equal(confirmStep(p, 4), "");
  assert.equal(p.status, "running");
  assert.equal(nextMove(p), "run");
  // non-publishing steps run without any OK; an OK on them is refused
  const q = plan({ current: 3, status: "waiting" });
  assert.match(confirmStep(q, 3), /doesn't need/);
  assert.equal(nextMove(plan({ current: 3 })), "run");
  assert.equal(nextMove(plan({ current: 5 })), "finish");
});

test("cancel stops the plan; a cancelled/failed plan can't be confirmed", () => {
  const p = plan({ current: 4, status: "waiting" });
  assert.equal(cancelPlan(p), "");
  assert.equal(nextMove(p), "stop");
  assert.match(confirmStep(p, 4), /isn't waiting/);
  assert.match(cancelPlan(p), /already ended/);
});

test("pick best: ready originals by score", () => {
  const clips = [{ id: "clip-1", status: "ready", score: 50 }, { id: "clip-2", status: "ready", score: 90 }, { id: "clip-3", status: "rejected", score: 99 },
    { id: "clip-2-v1", status: "ready", score: 95, variantOf: "clip-2" }, { id: "clip-4", status: "ready", score: 70 }];
  assert.deepEqual(pickBest(clips, 2), ["clip-2", "clip-4"]);
  assert.deepEqual(pickBest(clips, 9), ["clip-2", "clip-4", "clip-1"]);
});

test("progress line", () => {
  assert.equal(progressLine(plan({ current: 1, progress: 61.6 })), "Step 2/5: rendering… 62%");
  assert.equal(progressLine(plan({ current: 4, status: "waiting", picked: ["a", "b", "c"] })), "Step 5/5: schedule 3 clips into the next free slots — Waiting for your OK");
  assert.match(progressLine(plan({ current: 2, status: "failed", error: "No ready clips" })), /^Stopped at step 3\/5: No ready clips/);
  assert.equal(plansProblem({ v: 1, plans: [plan()] }), "");
  assert.notEqual(plansProblem({ v: 1, plans: [{}] }), "");
});

test("plan_task guard: only the user's own imperative, first tool", () => {
  assert.equal(actionBlocked("plan_task", "make 5 shorts from today's stream and schedule the best 3", false), "");
  assert.match(actionBlocked("plan_task", "can you tell me how plans work", false), /latest message/);
  assert.match(actionBlocked("plan_task", "what clips did you make?", false), /latest message/);
  assert.match(actionBlocked("plan_task", "make 5 shorts from today's stream", true), /first tool/);
});
