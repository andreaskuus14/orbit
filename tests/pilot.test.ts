import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTask, newGoal, okStep, pause, resume, startStep, stop, validateGoal, type Goal } from "../src/lib/goals-pure.ts";
import {
  CALLS_WAIT, MAX_REPLANS, acceptProposal, applyPilotReplan, callsLeft, chargeCalls, fromPilot, outsideKind, pilotInput, pilotLeft, pilotLine, pilotMove,
  pilotSteps, recovery, retryStep, setCalls, startPlan, waitCalls,
} from "../src/lib/pilot-pure.ts";
import { leftText } from "../src/lib/progress-pure.ts";
import { briefItems } from "../src/lib/brief-pure.ts";

const DAY = "2026-11-21", NOW = Date.parse("2026-11-21T10:00:00Z");
const ROSTER = ["nova", "atlas", "scout", "forge", "qa", "muse", "plinth", "closer", "prospector", "outreach", "echo"];
const PLAN = [
  { what: "Research what top pet simulator games do in their first week", agent: "atlas", planet: "intelligence", expected: "notes with sources", day: 1, minutes: 20 },
  { what: "Draft three thumbnail pictures for the game page", agent: "forge", planet: "creation", expected: "3 pictures", day: 1, minutes: 15, gpu: true },
  { what: "Write the update notes and the store description", agent: "muse", planet: "creation", expected: "text drafts", day: 2, minutes: 10 },
  { what: "Publish the update to Roblox", agent: "forge", planet: "creation", expected: "it is live", day: 3, minutes: 5 },
];

/** A started autopilot project (plan made, approved by his request). */
function project(calls = 40, plan: unknown[] = PLAN): Goal {
  const pi = pilotInput("Get my Roblox pet game ready for its first 100 players. Keep it cheap.", ROSTER, calls, DAY);
  if (typeof pi === "string") throw new Error(pi);
  const v = validateGoal(pi.input, ROSTER);
  if (typeof v === "string") throw new Error(v);
  const g: Goal = { ...newGoal(v, new Date(NOW)), pilot: pi.pilot };
  const st = pilotSteps(plan, g.agents);
  if (typeof st === "string") throw new Error(st);
  assert.equal(startPlan(g, st), "");
  return g;
}
/** Run step i to an end state the way the runner does (start → task row → applyTask). */
function finishStep(g: Goal, i: number, status: "done" | "failed", text = "ok") {
  assert.equal(startStep(g, i, `t${i}-${Math.random()}`, g.steps[i].id), "");
  return applyTask(g, i, status === "done" ? { status, result: text } : { status, error: text });
}

test("pilotInput: his words become title + ask, safe agents (no memory agent), default call limit; bad input refused", () => {
  const pi = pilotInput("Get my Roblox pet game ready for its first 100 players. Keep it cheap.", ROSTER, undefined, DAY);
  assert.ok(typeof pi !== "string");
  assert.equal(pi.input.title, "Get my Roblox pet game ready for its first 100 players.");
  assert.ok(!pi.input.agents.includes("echo") && pi.input.agents.length <= 10);
  assert.equal(pi.pilot.callsPerDay, 40);
  assert.match(pilotInput("hi", ROSTER, 10, DAY) as string, /Say what you want/);
  assert.match(pilotInput("Make me a nice website please", ROSTER, 1000, DAY) as string, /5-200/);
  assert.match(pilotInput("Make me a nice website please", ["echo"], 10, DAY) as string, /No agents/);
});

test("plan: starts by itself, steps mapped to planets / GPU / days; outside steps always gated, a planner label can't remove a gate", () => {
  const g = project();
  assert.equal(g.status, "approved");
  assert.deepEqual(g.steps.map((s) => s.meta?.planet), ["intelligence", "creation", "creation", "creation"]);
  assert.deepEqual(g.steps.map((s) => s.meta?.gpu), [false, true, false, false]);
  assert.deepEqual(g.steps.map((s) => s.meta?.day), [1, 1, 2, 3]);
  assert.deepEqual(g.steps.map((s) => s.needsApproval), [false, false, false, true]);
  assert.equal(g.steps[3].meta?.outside, "publish");
  // the planner says "outside: null" and "needsApproval: false" for a spend / sign-up / delete: the words still gate it
  const sneaky = pilotSteps([
    { what: "Buy 400 Robux of ads", agent: "forge", outside: null, needsApproval: false },
    { what: "Sign up for a Roblox analytics account", agent: "forge" },
    { what: "Delete the old test places", agent: "forge" },
    { what: "Email the 20 testers the invite", agent: "outreach" },
  ], g.agents);
  assert.ok(typeof sneaky !== "string");
  assert.deepEqual(sneaky.map((s) => [s.needsApproval, s.meta.outside]), [[true, "spend"], [true, "signup"], [true, "delete"], [true, "send"]]);
  assert.equal(outsideKind("Research competitor games"), null);
  // days never go backwards; LIFE is not a planet a step may use
  const d = pilotSteps([{ what: "a", agent: "atlas", day: 3 }, { what: "b", agent: "atlas", day: 1, planet: "life" }, { what: "c", agent: "atlas", day: 99 }], g.agents) as { meta: { day: number; planet: string } }[];
  assert.deepEqual(d.map((s) => s.meta.day), [3, 3, 14]);
  assert.equal(d[1].meta.planet, "operations");
  assert.match(pilotSteps([{ what: "x", agent: "nobody" }, { what: "y", agent: "atlas" }, { what: "z", agent: "atlas" }], g.agents) as string, /agent must be/);
  assert.match(startPlan(g, sneaky), /Only a new project/);
});

test("state machine: in order, GPU waits for a free GPU, later days wait, the outside step waits for his OK", () => {
  const g = project();
  assert.deepEqual(pilotMove(g, DAY, false), { do: "run", i: 0 });
  assert.equal(finishStep(g, 0, "done", "Top games ship daily rewards"), "done");
  assert.deepEqual(pilotMove(g, DAY, true), { do: "gpu", i: 1 });
  assert.deepEqual(pilotMove(g, DAY, false), { do: "run", i: 1 });
  finishStep(g, 1, "done", "3 pictures saved");
  assert.deepEqual(pilotMove(g, DAY, false), { do: "later", i: 2, day: "2026-11-22" });
  assert.deepEqual(pilotMove(g, "2026-11-22", false), { do: "run", i: 2 });
  finishStep(g, 2, "done");
  assert.deepEqual(pilotMove(g, "2026-11-23", false), { do: "ask_ok", i: 3 });
  assert.equal(okStep(g, 3, g.steps[3].id), "");
  assert.deepEqual(pilotMove(g, "2026-11-23", false), { do: "run", i: 3 });
  finishStep(g, 3, "done", "Live");
  assert.deepEqual(pilotMove(g, "2026-11-23", false), { do: "finish" });
});

test("pause / resume / stop: a paused project does nothing; stop ends it with the running step cancelled", () => {
  const g = project();
  assert.equal(pause(g), "");
  assert.deepEqual(pilotMove(g, DAY, false), { do: "idle" });
  assert.equal(resume(g), "");
  assert.deepEqual(pilotMove(g, DAY, false), { do: "run", i: 0 });
  startStep(g, 0, "t", g.steps[0].id);
  const s = stop(g);
  assert.deepEqual(s, { taskId: "t" });
  assert.equal(g.status, "stopped");
  assert.deepEqual(pilotMove(g, DAY, false), { do: "idle" });
  assert.equal(recovery(g, 0, DAY).do, "stuck"); // a stopped step is never retried
  assert.equal(fromPilot("p1", g, "en", { nowMs: NOW, day: DAY, at: "" }).phase, "failed");
});

test("hard daily call limit: a step needs its whole call budget up front; tomorrow it goes on; his new limit unblocks", () => {
  const g = project(12); // callsPerStep 6 → two steps a day
  for (let k = 0; k < 2; k++) {
    const m = pilotMove(g, DAY, false);
    assert.equal(m.do, "run");
    assert.ok(chargeCalls(g.pilot!, g.budget.callsPerStep, DAY));
    finishStep(g, k, "done");
  }
  assert.equal(callsLeft(g.pilot!, DAY), 0);
  assert.equal(chargeCalls(g.pilot!, 1, DAY), false); // nothing over the limit, not even one call
  g.steps[2].meta!.day = 1;
  assert.deepEqual(pilotMove(g, DAY, false), { do: "calls" });
  assert.ok(waitCalls(g));
  assert.equal(g.waitingFor, CALLS_WAIT);
  assert.equal(pilotMove(g, "2026-11-22", false).do, "run"); // a new day, a fresh limit
  assert.equal(setCalls(g, 3), "The daily Claude-call limit must be 5-200");
  assert.equal(setCalls(g, 30), "");
  assert.equal(g.status, "approved");
  assert.equal(pilotMove(g, DAY, false).do, "run");
});

test("replanning: a failed step is retried once, then Opus's new steps replace it and the rest; bounded; owner rejection replans at once", () => {
  const g = project();
  assert.equal(finishStep(g, 0, "failed", "Search timed out"), "failed");
  assert.equal(g.status, "blocked");
  assert.deepEqual(recovery(g, 0, DAY), { do: "retry", i: 0 });
  assert.equal(retryStep(g, 0), "");
  assert.equal(g.status, "approved");
  finishStep(g, 0, "failed", "Search timed out again");
  assert.deepEqual(recovery(g, 0, DAY), { do: "replan", i: 0 });
  const raw = { reason: "Use the saved notes instead of a live search", steps: [
    { what: "Summarise the saved Roblox notes in VAULT", agent: "atlas", planet: "vault", day: 1, minutes: 10 },
    { what: "Post the update on the Roblox group wall", agent: "forge", planet: "creation", day: 2, outside: null },
  ] };
  assert.equal(applyPilotReplan(g, 0, raw, DAY), "");
  assert.equal(g.status, "approved");
  assert.equal(g.steps.length, 2);
  assert.equal(g.pilot!.replans, 1);
  assert.equal(g.steps[1].needsApproval, true); // the new plan's outside step is gated too
  assert.equal(applyPilotReplan(g, 0, raw, DAY), "The plan moved on"); // a stale replan never lands twice
  // garbage from the model: nothing changes
  finishStep(g, 0, "failed", "x");
  g.pilot!.tries[g.steps[0].id] = 1;
  assert.match(applyPilotReplan(g, 0, { steps: "no" }, DAY), /wasn't usable/);
  assert.equal(g.steps.length, 2);
  // the cap: no more automatic replans → stuck, waiting for his Try again
  g.pilot!.replans = MAX_REPLANS;
  assert.deepEqual(recovery(g, 0, DAY), { do: "stuck", i: 0 });
  // he rejected a step's actions: no blind retry, straight to a replan
  const h = project();
  startStep(h, 0, "t", h.steps[0].id);
  applyTask(h, 0, { status: "done", result: "r", pending: [{ status: "rejected" }] });
  assert.deepEqual(recovery(h, 0, DAY), { do: "replan", i: 0 });
  // out of calls for the replan → wait for tomorrow
  h.pilot!.calls = { day: DAY, used: h.pilot!.callsPerDay };
  assert.deepEqual(recovery(h, 0, DAY), { do: "calls" });
});

test("new information: a review's plan change applies by itself with the gates, until the replan cap; then it waits for him", () => {
  const g = project();
  finishStep(g, 0, "done");
  g.proposal = { reason: "Players want trading first", from: 1, steps: [{ what: "Design a trading screen", agent: "forge", expected: "mockup", needsApproval: false }, { what: "Upload the trading update", agent: "forge", expected: "live", needsApproval: false }] };
  assert.deepEqual(pilotMove(g, DAY, false), { do: "accept" });
  assert.equal(acceptProposal(g, DAY), "");
  assert.equal(g.proposal, undefined);
  assert.deepEqual(g.steps.slice(1).map((s) => [s.what, s.needsApproval]), [["Design a trading screen", false], ["Upload the trading update", true]]);
  assert.equal(g.pilot!.replans, 1);
  g.pilot!.replans = MAX_REPLANS;
  g.proposal = { reason: "again", from: 1, steps: [{ what: "Something else", agent: "forge", expected: "", needsApproval: false }] };
  assert.equal(pilotMove(g, DAY, false).do, "wait");
  const c = fromPilot("p1", g, "en", { nowMs: NOW, day: DAY, at: "" });
  assert.equal(c.phase, "needs");
  assert.equal(c.action?.open, "#o=agents&k=goal&id=p1");
});

test("card: one card, ✓/●/○, doing-now, time left across days, latest result, Stop-all and pacer holds, button only opens", () => {
  const g = project();
  finishStep(g, 0, "done", "Top games ship daily rewards\nmore");
  startStep(g, 1, "t1", g.steps[1].id);
  let c = fromPilot("p1", g, "en", { nowMs: NOW, day: DAY, at: "2026-11-21T10:00:00Z" });
  assert.equal(c.id, "pilot:p1");
  assert.deepEqual(c.steps.map((s) => s.state), ["done", "now", "next", "next"]);
  assert.ok(c.steps[3].label.endsWith("🔒"));
  assert.equal(c.phase, "working");
  assert.match(c.now!, /^Doing now: Draft three thumbnail/);
  assert.equal(c.result?.text, "Latest: Top games ship daily rewards");
  assert.ok(c.leftMin! > 1440); // the plan runs to day 3
  assert.match(leftText(c.leftMin, "en"), /days? left|h left/);
  assert.equal(c.action, null);
  c = fromPilot("p1", g, "en", { nowMs: NOW, day: DAY, at: "", stopAll: true });
  assert.equal(c.now, "Paused by Stop-all");
  c = fromPilot("p1", g, "et", { nowMs: NOW, day: DAY, at: "", usage: "Keeping your window fresh until 07:30" });
  assert.match(c.now!, /^Ootel: /);
  // waiting for his OK → "needs" with one button that opens the project (never an approve call)
  applyTask(g, 1, { status: "done", result: "pics" });
  g.status = "waiting"; g.waitingFor = "your OK on step 3";
  c = fromPilot("p1", g, "en", { nowMs: NOW, day: DAY, at: "" });
  assert.equal(c.phase, "needs");
  assert.deepEqual(c.action, { kind: "approve", label: "Approve", open: "#o=agents&k=goal&id=p1" });
  assert.equal(pilotLeft({ ...g, steps: g.steps.map((s) => ({ ...s, status: "done" as const })) }, DAY, NOW), 0);
});

test("morning brief: one daily line per project in one item", () => {
  const g = project();
  finishStep(g, 0, "done");
  const line = pilotLine(g, "en", DAY, NOW, leftText);
  assert.match(line, /^Get my Roblox pet game ready for its first 100 pl…: 1\/4 steps done, next: Draft three thumbnail/);
  assert.match(line, /left$/);
  const items = briefItems({ day: DAY, hour: 8, life: false, morning: {} as never, decisions: [], replies: [], snoozed: [], pilots: [{ id: "p1", line }] } as never);
  const it = items.find((x) => x.id === `pilots:${DAY}`)!;
  assert.ok(it.title.startsWith("Autopilot: "));
  assert.deepEqual(it.open, { goal: "p1" });
});
