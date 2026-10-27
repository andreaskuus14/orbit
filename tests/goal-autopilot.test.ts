import { test } from "node:test";
import assert from "node:assert/strict";
import { newGoal, setPlan, validateGoal, validateSteps, type Goal, type StepDraft } from "../src/lib/goals-pure.ts";
import { applyPhrasing, applyReplan, burnup, expectedAt, milestonePlan, proposeReplan, sameReplan, setupAutopilot, trackGoal, type Evidence } from "../src/lib/goal-autopilot-pure.ts";
import { briefItems } from "../src/lib/brief-pure.ts";

const START = "2026-10-01", DEADLINE = "2026-10-29"; // 4 weeks
function goal(status: Goal["status"] = "approved"): Goal {
  const v = validateGoal({ title: "Post 20 Shorts", agents: ["forge", "atlas"], deadline: DEADLINE }, ["forge", "atlas"]);
  if (typeof v === "string") throw new Error(v);
  const g = newGoal(v, new Date(`${START}T09:00:00Z`));
  setPlan(g, validateSteps([1, 2, 3].map((n) => ({ what: `Draft batch ${n}`, agent: "forge", expected: "drafts" })), g.agents) as StepDraft[]);
  g.status = status;
  assert.equal(setupAutopilot(g, "shorts", 20, START), "");
  return g;
}
const shorts = (...days: string[]): Evidence[] => days.map((d) => ({ at: `${d}T12:00:00Z`, type: "clip.published", data: { clipId: d } }));

test("milestonePlan: weekly checkpoints, last on the deadline, cumulative targets reach total", () => {
  const m = milestonePlan("shorts", START, DEADLINE, 20);
  assert.ok(Array.isArray(m));
  assert.deepEqual(m.map((x) => [x.due, x.target]), [["2026-10-08", 5], ["2026-10-15", 10], ["2026-10-22", 15], ["2026-10-29", 20]]);
  assert.match(m[0].doneWhen, /^5 Shorts published since 2026-10-01$/);
  const odd = milestonePlan("tasks", START, "2026-10-18", 7) as { due: string; target: number }[];
  assert.equal(odd.at(-1)!.due, "2026-10-18");
  assert.equal(odd.at(-1)!.target, 7);
  assert.match(milestonePlan("shorts", START, START, 5) as string, /after today/);
  assert.match(milestonePlan("shorts", START, "2028-01-01", 5) as string, /52 weeks/);
  assert.match(milestonePlan("nope" as never, START, DEADLINE, 5) as string, /evidence/);
  assert.match(milestonePlan("shorts", START, DEADLINE, 0) as string, /total/);
});

test("setupAutopilot needs a deadline and a live goal", () => {
  const g = goal();
  delete g.deadline;
  assert.match(setupAutopilot(g, "shorts", 5, START), /deadline/);
});

test("expectedAt interpolates between checkpoints", () => {
  const g = goal();
  assert.equal(expectedAt(g.autopilot!, START), 0);
  assert.equal(expectedAt(g.autopilot!, "2026-10-08"), 5);
  assert.equal(expectedAt(g.autopilot!, "2026-10-11"), 5 + (5 * 3) / 7);
  assert.equal(expectedAt(g.autopilot!, "2026-12-01"), 20);
});

test("evidence matching: kind, start date, goal-scoped steps", () => {
  const g = goal();
  g.steps[0].taskId = "t1";
  const ev: Evidence[] = [...shorts("2026-09-30", "2026-10-02"), { at: "2026-10-03T00:00:00Z", type: "task.done", data: { id: "t1" } }, { at: "2026-10-03T00:00:00Z", type: "task.done", data: { id: "other" } }];
  assert.equal(trackGoal(g, ev, "2026-10-05")!.actual, 1); // the one before start doesn't count
  g.autopilot!.evidence = "steps";
  assert.equal(trackGoal(g, ev, "2026-10-05")!.actual, 1);
  g.autopilot!.evidence = "tasks";
  assert.equal(trackGoal(g, ev, "2026-10-05")!.actual, 2);
});

test("status math: on-track, at-risk (missed checkpoint), behind, done", () => {
  const g = goal();
  const five = shorts("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06");
  const t = trackGoal(g, five, "2026-10-08")!;
  assert.equal(t.track, "on-track");
  assert.deepEqual(t.checks.map((c) => c.met), [true, null, null, null]);
  assert.equal(trackGoal(g, five.slice(0, 4), "2026-10-08")!.track, "at-risk"); // 4/5 = 0.8
  assert.equal(trackGoal(g, five.slice(0, 2), "2026-10-08")!.track, "behind");
  // ahead on count but last week's checkpoint was missed → at-risk
  const late = shorts("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09", "2026-10-09");
  assert.equal(trackGoal(g, late, "2026-10-09")!.track, "at-risk");
  assert.equal(trackGoal(g, shorts(...Array.from({ length: 20 }, () => "2026-10-02")), "2026-10-03")!.track, "done");
  assert.equal(trackGoal(g, five, "2026-11-01")!.track, "behind"); // past the deadline, not done
  assert.equal(trackGoal({ ...g, autopilot: undefined }, five, "2026-10-08"), null);
});

test("re-plan: night catch-up for a small gap, cut scope at a decent pace, else shift the deadline", () => {
  const g = goal();
  // small gap (≤ a week's quota of 5) → a night step, no side-effect words → runs unattended
  const night = proposeReplan(g, g.autopilot!, 2, 6, 1, "2026-10-09")!;
  assert.equal(night.kind, "night");
  assert.ok(night.kind === "night" && !night.step.needsApproval && night.step.agent === "forge");
  // big gap, pace reaches ≥ 60 % → cut to the reachable total
  const cut = proposeReplan(g, g.autopilot!, 6, 13, 3, "2026-10-15")!;
  assert.deepEqual(cut.kind === "cut" && cut.total, 6 + Math.floor(3 * 2));
  assert.equal(cut.kind, "cut");
  // nothing counted lately → shift at the plan's own pace
  const shift = proposeReplan(g, g.autopilot!, 2, 13, 0, "2026-10-15")!;
  assert.equal(shift.kind, "shift");
  assert.ok(shift.kind === "shift" && shift.deadline > DEADLINE);
  assert.equal(shift.kind === "shift" && shift.deadline, "2026-11-12"); // 18 left / 5 a week → 4 weeks from 10-15
  // a goal that can't take a step (draft) gets a date/scope re-plan instead of a night task
  const d = goal("draft");
  assert.notEqual(proposeReplan(d, d.autopilot!, 2, 6, 1, "2026-10-09")!.kind, "night");
  assert.equal(proposeReplan(g, g.autopilot!, 20, 13, 0, "2026-10-15"), null);
});

test("re-plan only via applyReplan; stale proposals don't match", () => {
  const g = goal();
  const t = trackGoal(g, shorts("2026-10-02"), "2026-10-15")!;
  assert.equal(t.track, "behind");
  assert.ok(t.replan);
  assert.equal(g.autopilot!.total, 20); // proposing changed nothing
  assert.ok(sameReplan(t.replan, JSON.parse(JSON.stringify(t.replan))));
  assert.ok(!sameReplan(t.replan, { ...t.replan, why: "x" }));
  assert.ok(!sameReplan(null, t.replan));

  const shifted = goal();
  assert.equal(applyReplan(shifted, { kind: "shift", deadline: "2026-11-12", why: "" }), "");
  assert.equal(shifted.deadline, "2026-11-12");
  assert.equal(shifted.autopilot!.milestones.at(-1)!.due, "2026-11-12");
  assert.equal(shifted.autopilot!.milestones.length, 6);

  const cut = goal();
  assert.equal(applyReplan(cut, { kind: "cut", total: 12, why: "" }), "");
  assert.equal(cut.autopilot!.total, 12);
  assert.equal(cut.autopilot!.milestones.at(-1)!.target, 12);

  const n = goal(), step = { what: "Catch-up drafts", agent: "forge", expected: "drafts", needsApproval: false };
  assert.equal(applyReplan(n, { kind: "night", step, why: "" }), "");
  assert.equal(n.steps.length, 4);
  assert.equal(n.steps[3].status, "pending");
  assert.match(applyReplan(n, { kind: "night", step: { ...step, agent: "evil" }, why: "" }), /agent/);
  assert.match(applyReplan({ ...n, autopilot: undefined }, { kind: "cut", total: 3, why: "" }), /no milestones/);
});

test("burnup: plan + actual series from start to deadline, actual null in the future", () => {
  const g = goal(), b = burnup(g, shorts("2026-10-02", "2026-10-03"), "2026-10-05");
  assert.equal(b[0].day, START);
  assert.equal(b.at(-1)!.day, DEADLINE);
  assert.equal(b.at(-1)!.plan, 20);
  assert.equal(b.find((p) => p.day === "2026-10-05")!.actual, 2);
  assert.equal(b.find((p) => p.day === "2026-10-06")!.actual, null);
});

test("applyPhrasing keeps numbers: a line without its target keeps the default", () => {
  const g = goal();
  assert.equal(applyPhrasing(g, { doneWhen: ["5 Shorts live on the channel", "Ten Shorts out", "15 Shorts up", "All 20 Shorts published"] }), 3);
  assert.equal(g.autopilot!.milestones[0].doneWhen, "5 Shorts live on the channel");
  assert.match(g.autopilot!.milestones[1].doneWhen, /^10 Shorts published/);
  assert.equal(applyPhrasing(g, { doneWhen: ["only one"] }), 0);
  assert.equal(applyPhrasing(g, null), 0);
  assert.equal(applyPhrasing(g, { doneWhen: ["15 a", "150 b", "x", "y"] }), 0); // "15" isn't target 5, "150" isn't 10
});

test("brief: an at-risk goal gets one line that opens the goal", () => {
  const base = { day: "2026-10-26", hour: 8, life: false, morning: {} as never, decisions: [], replies: [], snoozed: [] };
  const it = briefItems({ ...base, goalRisk: { id: "g1", title: "Goal behind: X", say: "Your goal X is behind." } });
  assert.deepEqual(it.map((i) => [i.id, i.open]), [["goalrisk:g1", { goal: "g1" }]]);
  assert.equal(briefItems({ ...base, goalRisk: { id: "g1", title: "t", say: "s" }, snoozed: ["goalrisk:g1"] }).length, 0);
});
