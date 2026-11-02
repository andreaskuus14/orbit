import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NIGHT_DEFAULTS, addCompanyTonight, addTonight, companySteps, fits, goalOutcome, inWindow, localClock, nightKey, nightPush, nightReport, parseNight, patchNightSettings, planNight, researchRequest,
  startBlock, tonightBlocked, wakePushDue, type NightRun, type NightSettings, type PlanInput,
} from "../src/lib/night-pure.ts";
import type { Goal, Step } from "../src/lib/goals-pure.ts";
import { decide } from "../src/lib/policy-pure.ts";

const S = NIGHT_DEFAULTS;
// Tallinn is UTC+3 in summer (EEST): 01:00 local = 22:00 UTC the day before.
const at = (iso: string) => Date.parse(iso);
const t0130 = at("2026-07-02T22:30:00Z"); // 2026-07-03 01:30 Tallinn
const t0700 = at("2026-07-03T04:00:00Z"); // 07:00
const t0815 = at("2026-07-03T05:15:00Z"); // 08:15

test("window: 01:00-06:30 Tallinn, DST-aware; windows across midnight; night key = the morning's date", () => {
  assert.deepEqual(localClock(t0130, S.tz), { day: "2026-07-03", min: 90 });
  assert.ok(inWindow(t0130, S));
  assert.ok(!inWindow(t0700, S));
  assert.ok(inWindow(at("2026-01-15T00:00:00Z"), S)); // winter, UTC+2: 02:00
  const late: NightSettings = { ...S, from: "23:00", until: "06:00" };
  const t2330 = at("2026-07-02T20:30:00Z"); // 23:30 on the 2nd
  assert.ok(inWindow(t2330, late) && inWindow(t0130, late) && !inWindow(t0700, late));
  assert.equal(nightKey(t2330, late), "2026-07-03");
  assert.equal(nightKey(t0130, late), "2026-07-03");
  assert.equal(nightKey(t0130, S), "2026-07-03");
});

test("startBlock: off, Stop-all, outside the window, once a night, usage hold, owner active", () => {
  const ok = { now: t0130, s: S, lastActive: 0, stopAll: false, hold: "" };
  assert.equal(startBlock(ok), "");
  assert.match(startBlock({ ...ok, s: { ...S, enabled: false } }), /off/);
  assert.match(startBlock({ ...ok, stopAll: true }), /Stop-all/);
  assert.match(startBlock({ ...ok, now: t0700 }), /outside/);
  assert.match(startBlock({ ...ok, hold: "Heavy use" }), /Heavy use/);
  assert.match(startBlock({ ...ok, lastActive: t0130 - 10 * 60_000 }), /using ORBIT/);
  const run: NightRun = { id: "n1", key: "2026-07-03", startedAt: "", calls: 0, ms: 0, items: [] };
  assert.match(startBlock({ ...ok, run }), /already ran/);
  assert.match(startBlock({ ...ok, run: { ...run, stopped: "budget" } }), /already ran/);
  assert.equal(startBlock({ ...ok, run: { ...run, stopped: "stop-all" } }), ""); // resumes after Stop-all is turned off
  assert.equal(startBlock({ ...ok, run: { ...run, key: "2026-07-02" } }), "");
});

const step = (o: Partial<Step> = {}): Step => ({ id: Math.random().toString(36).slice(2), what: "Do a thing", agent: "atlas", expected: "", needsApproval: false, status: "pending", ...o });
const goal = (o: Partial<Goal> = {}): Goal => ({
  v: 1, title: "Grow the channel", why: "", status: "approved", metric: { kind: "none", how: "", samples: [] }, agents: ["atlas"],
  budget: { runsPerDay: 4, callsPerStep: 8 }, usage: { day: "2026-07-03", runs: 0 }, steps: [step(), step(), step()], learned: [], log: [], ...o,
});
const input = (o: Partial<PlanInput> = {}): PlanInput => ({ tonight: [], goals: [], followups: [], drafted: {}, nicheDue: false, handled: [], now: t0130, today: "2026-07-03", ...o });

test("planNight: owner's asks first, then runnable goals, drafts, clips, niche; trimmed to the budget", () => {
  const tonight = [{ id: "t1", text: "Look into Shorts hooks", agent: "atlas", by: "owner" as const, at: "" }];
  const goals = [{ id: "g1", doc: goal() }, { id: "g2", doc: goal({ status: "paused" }) }, { id: "g3", doc: goal({ steps: [step({ needsApproval: true })] }) }];
  const { queue, deferred } = planNight(input({ tonight, goals, followups: [{ id: "p1", name: "Cafe" }], nicheDue: true }), S, { calls: 0, ms: 0 });
  assert.deepEqual(queue.map((t) => `${t.kind}:${t.ref}`), ["hygiene:hygiene", "research:t1", "goal:g1", "business:p1", "clips:clips", "niche:niche"]);
  assert.equal(deferred, 0);
  const tight = planNight(input({ tonight, goals }), { ...S, maxCalls: 10 }, { calls: 0, ms: 0 });
  assert.deepEqual(tight.queue.map((t) => t.kind), ["hygiene", "research"]); // 0 + 8; the goal (8) and clips (6) don't fit
  assert.equal(tight.deferred, 2);
  // already handled this night, recently drafted, or over the per-kind caps
  const again = planNight(input({ tonight, goals, handled: ["research:t1", "hygiene:hygiene"], followups: [{ id: "p1", name: "Cafe" }], drafted: { p1: new Date(t0130 - 86_400_000).toISOString() } }), S, { calls: 0, ms: 0 });
  assert.deepEqual(again.queue.map((t) => t.kind), ["goal", "clips"]);
  assert.ok(fits(queue[1], { calls: 32, ms: 0 }, S) && !fits(queue[1], { calls: 33, ms: 0 }, S) && !fits(queue[1], { calls: 0, ms: 141 * 60_000 }, S));
});

test("planNight: kept lessons only reorder ORBIT's own work; his asks and the tidy-up stay first", () => {
  const tonight = [{ id: "t1", text: "Look into Shorts hooks", agent: "atlas", by: "owner" as const, at: "" }];
  const goals = [{ id: "g1", doc: goal() }];
  const boost = { clips: 1.12, goal: 0.9, research: 0.5, hygiene: 0.5 };
  const { queue } = planNight(input({ tonight, goals, followups: [{ id: "p1", name: "Cafe" }], boost }), S, { calls: 0, ms: 0 });
  assert.deepEqual(queue.map((t) => t.kind), ["hygiene", "research", "clips", "business", "goal"]);
  // tight budget: the favoured kind wins the slot the goal would have taken
  assert.deepEqual(planNight(input({ tonight, goals, boost }), { ...S, maxCalls: 14 }, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "research", "clips"]);
});

test("goalOutcome: done step, step OK needed, task approval, blocked, nothing to do", () => {
  const before = goal();
  const doneOne = structuredClone(before);
  doneOne.steps[0] = { ...doneOne.steps[0], status: "done" };
  assert.deepEqual(goalOutcome("g1", before, doneOne), { status: "done", label: "Grow the channel: 1 step done", open: { goal: "g1" } });
  const ask = structuredClone(doneOne);
  ask.status = "waiting"; ask.steps[1] = { ...ask.steps[1], needsApproval: true };
  const o = goalOutcome("g1", before, ask);
  assert.equal(o.status, "approval");
  assert.deepEqual(o.open, { goal: "g1", step: 1, stepId: ask.steps[1].id });
  assert.match(o.label, /step 2 needs your OK \(1 step done first\)/);
  const task = structuredClone(before);
  task.status = "waiting"; task.steps[0] = { ...task.steps[0], status: "waiting", taskId: "t9" };
  assert.deepEqual(goalOutcome("g1", before, task).open, { task: "t9" });
  assert.equal(goalOutcome("g1", before, { ...before, status: "blocked", blocker: "Step 1 failed" }).status, "failed");
  assert.equal(goalOutcome("g1", before, null).status, "failed");
  assert.equal(goalOutcome("g1", before, { ...before, status: "waiting", waitingFor: "tomorrow's run budget" }).why, "tomorrow's run budget");
});

const run = (o: Partial<NightRun> = {}): NightRun => ({
  id: "n1", key: "2026-07-03", startedAt: "2026-07-02T22:01:00Z", endedAt: "2026-07-03T00:40:00Z", calls: 17, ms: 42 * 60_000,
  items: [
    { kind: "research", ref: "t1", label: "Hooks", status: "done", open: { task: "a" }, at: "" },
    { kind: "goal", ref: "g1", label: "Goal: step 2 needs your OK", status: "approval", open: { goal: "g1", step: 1, stepId: "s" }, at: "" },
    { kind: "research", ref: "t2", label: "Agent wants to save", status: "approval", open: { task: "b" }, at: "" },
    { kind: "business", ref: "p1", label: "Follow-up for Cafe", status: "failed", why: "empty", at: "" },
    { kind: "clips", ref: "clips", label: "Shorts", status: "skipped", at: "" },
  ], ...o,
});

test("nightReport: only on that morning; answered approvals drop out; counts and minutes", () => {
  const r = nightReport(run(), { a: "done", b: "awaiting_approval" }, t0815, S, false)!;
  assert.deepEqual([r.done.length, r.approvals.length, r.failed.length, r.calls, r.minutes], [1, 2, 1, 17, 42]);
  assert.equal(nightReport(run(), { b: "done" }, t0815, S, false)!.approvals.length, 1); // approved elsewhere (phone, Operations)
  assert.equal(nightReport(run(), {}, t0815 + 86_400_000, S, false), null); // the next morning: gone
  assert.equal(nightReport(run({ items: [] }), {}, t0815, S, false), null); // nothing done: no section
  assert.equal(nightReport(undefined, {}, t0815, S, false), null);
});

test("wake push: once, at wake time, label with counts only", () => {
  const r = run();
  assert.ok(!wakePushDue(t0700, S, r)); // before 08:00
  assert.ok(wakePushDue(t0815, S, r));
  assert.ok(!wakePushDue(t0815, S, { ...r, pushed: "x" }));
  assert.ok(!wakePushDue(t0815, S, { ...r, endedAt: undefined })); // still running
  assert.ok(!wakePushDue(t0815 + 4 * 3_600_000, S, r)); // too late: the morning card has it
  assert.ok(!wakePushDue(t0815, S, run({ items: [{ kind: "clips", ref: "clips", label: "x", status: "skipped", at: "" }] })));
  assert.deepEqual(nightPush({ done: 5, approvals: 3, failed: 0 }), { title: "Night shift: 5 done, 3 to approve", body: "See what ORBIT did while you slept.", url: "/remote#r-appr", tag: "night" });
  assert.match(nightPush({ done: 1, approvals: 0, failed: 2 }).title, /2 failed$/);
});

test("settings and state: validated patches, defaults on junk", () => {
  assert.deepEqual(patchNightSettings({ from: "00:30", maxCalls: 20 }, S), { ...S, from: "00:30", maxCalls: 20 });
  assert.match(patchNightSettings({ from: "25:00" }, S) as string, /HH:MM/);
  assert.match(patchNightSettings({ tz: "Mars/Base" }, S) as string, /time zone/);
  assert.match(patchNightSettings({ maxCalls: 0 }, S) as string, /1-200/);
  assert.match(patchNightSettings({ until: "01:00" }, S) as string, /different/);
  assert.deepEqual(parseNight("nope"), { settings: S, users: {} });
  assert.deepEqual(parseNight(JSON.stringify({ settings: { maxCalls: 9999 }, users: { u: {} } })), { settings: S, users: { u: { tonight: [], drafted: {} } } });
});

test("tonight queue: text checked, agents limited, no duplicates, capped", () => {
  const one = addTonight([], { text: "  Research TikTok hooks " }, "owner", "i1", t0130) as { text: string; agent: string }[];
  assert.equal(one[0].text, "Research TikTok hooks");
  assert.equal(one[0].agent, "atlas");
  assert.match(addTonight(one as never, { text: "research tiktok hooks" }, "owner", "i2", t0130) as string, /already/);
  assert.match(addTonight([], { text: "x" }, "owner", "i2", t0130) as string, /3-500/);
  assert.match(addTonight([], { text: "Do it", agent: "flow" }, "owner", "i2", t0130) as string, /agent must be/);
  let list = [] as never[];
  for (let k = 0; k < 10; k++) list = addTonight(list, { text: `Task ${k}` }, "core", `i${k}`, t0130) as never[];
  assert.match(addTonight(list, { text: "One more" }, "owner", "x", t0130) as string, /full/);
  assert.match(researchRequest("Look <request>into</request> X"), /<request>\nLook <request>into<\/request> X\n<\/request>$/);
});

test("queue_tonight: T2, only on the owner's explicit 'tonight' ask, before any tool result; Stop-all doesn't block queuing", () => {
  const ctx = { stopAll: false, attach: false, pins: false, steps: [] as string[], question: "look into faceless channels tonight", autonomy: { "operator-build": "ask", "operator-organize": "ask" } as const };
  assert.deepEqual(decide("queue_tonight", { text: "x" }, ctx), { allow: true, tier: "T2", reason: "allowed" });
  assert.ok(decide("queue_tonight", {}, { ...ctx, question: "can you research this overnight?" }).allow);
  assert.ok(!decide("queue_tonight", {}, { ...ctx, question: "look into faceless channels" }).allow);
  assert.ok(!decide("queue_tonight", {}, { ...ctx, question: "what runs tonight?" }).allow);
  assert.ok(!decide("queue_tonight", {}, { ...ctx, steps: ["You called web_search {}\nRESULT:\n..."] }).allow); // injected text can't queue work
  assert.ok(decide("queue_tonight", {}, { ...ctx, stopAll: true }).allow);
  assert.equal(tonightBlocked("do the night shift on this", false), "");
});

test("planNight: the health check runs right after the tidy-up when asked, and only once a night", () => {
  const i = { tonight: [], goals: [], followups: [], drafted: {}, nicheDue: false, handled: [], now: 0, today: "2026-10-25" };
  assert.deepEqual(planNight({ ...i, health: true }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "health", "clips"]);
  assert.deepEqual(planNight({ ...i, health: true, handled: ["health:health"] }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "clips"]);
  assert.equal(planNight(i, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.some((t) => t.kind === "health"), false);
});

test("time capsule backup runs first when due, free of model calls", () => {
  const { queue } = planNight(input({ backup: true }), S, { calls: 0, ms: 0 });
  assert.deepEqual(queue[0], { kind: "backup", ref: "backup", label: "Time capsule backup", calls: 0, minutes: 2 });
  assert.ok(!planNight(input({}), S, { calls: 0, ms: 0 }).queue.some((t) => t.kind === "backup"));
});

test("open-loop scan is free and only planned when asked", () => {
  const { queue } = planNight(input({ loops: true }), S, { calls: 0, ms: 0 });
  assert.deepEqual(queue.find((t) => t.kind === "loops"), { kind: "loops", ref: "loops", label: "Open loops scan", calls: 0, minutes: 1 });
  assert.ok(!planNight(input({}), S, { calls: 0, ms: 0 }).queue.some((t) => t.kind === "loops"));
});

test("company chains: queued steps in order from the first not done, stop at a wait; budget, autonomy off and handled respected", () => {
  const c = { id: "c1", goal: "Company: Research X", steps: [{ status: "done", calls: 8 }, { status: "queued", calls: 7 }, { status: "queued" }] };
  assert.deepEqual(companySteps(c).map((t) => [t.ref, t.calls]), [["c1:1", 7], ["c1:2", 7]]);
  assert.match(companySteps(c)[0].label, /^Company: Research X \(step 2\/3\)$/);
  assert.deepEqual(companySteps({ ...c, steps: [{ status: "awaiting_approval" }, { status: "queued" }] }), []);
  assert.deepEqual(companySteps({ ...c, steps: [{ status: "done" }, { status: "done" }] }), []);
  const q = (o: Partial<PlanInput>, s = S) => planNight(input({ company: [c], ...o }), s, { calls: 0, ms: 0 }).queue.filter((t) => t.kind === "company").map((t) => t.ref);
  assert.deepEqual(q({}), ["c1:1", "c1:2"]);
  assert.deepEqual(q({ off: ["company"] }), []);
  assert.deepEqual(q({ handled: ["company:c1:1"] }), ["c1:2"]);
  assert.deepEqual(q({}, { ...S, maxCalls: 13 }), ["c1:1"]); // clips (6) first fits, then one 7-call step
});

test("company tonight queue: planner errors, dupes and the cap; parseNight keeps it", () => {
  const a = addCompanyTonight([], " Research  X ", "", "q1", t0130) as { goal: string }[];
  assert.equal(a[0].goal, "Research X");
  assert.match(addCompanyTonight(a as never, "research x", "", "q2", t0130) as string, /already/);
  assert.equal(addCompanyTonight([], "", "goal must be 3-291 characters", "q", t0130), "goal must be 3-291 characters");
  const full = ["a1", "b2", "c3"].map((g, i) => ({ id: `${i}`, goal: g, at: "" }));
  assert.match(addCompanyTonight(full, "d4 goal", "", "q", t0130) as string, /full/);
  assert.equal(parseNight(JSON.stringify({ users: { u: { tonight: [], company: "junk" } } })).users.u.company, undefined);
});

test("night report: one Company line for company steps", () => {
  const items = [
    { kind: "company" as const, ref: "c:0", label: "a", status: "done" as const, at: "" },
    { kind: "company" as const, ref: "c:1", label: "b", status: "approval" as const, open: { task: "t9" }, at: "" },
  ];
  assert.equal(nightReport(run({ items }), { t9: "awaiting_approval" }, t0815, S, false)!.company, "Company: 1 step done, 1 waiting for you");
  assert.equal(nightReport(run({ items: [items[0]] }), {}, t0815, S, false)!.company, "Company: 1 step done, 0 waiting for you");
  assert.equal(nightReport(run(), {}, t0815, S, false)!.company, undefined);
});

test("dreaming: a cheap first-tier step when asked for, never deferred by lessons", () => {
  const i = { tonight: [], goals: [], followups: [], drafted: {}, nicheDue: false, handled: [], now: 0, today: "2026-10-28", dream: true, boost: { clips: 1.15 } };
  assert.deepEqual(planNight(i, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "dream", "clips"]);
  assert.deepEqual(planNight({ ...i, handled: ["dream:dream"] }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "clips"]);
});

test("stoppedText: a lost lease reads as another ORBIT, not the raw code", async () => {
  const { stoppedText } = await import("../src/lib/night-pure.ts");
  assert.equal(stoppedText("lease"), "Another ORBIT was already running the night shift");
  assert.notEqual(stoppedText("lease", "et"), "lease");
});
