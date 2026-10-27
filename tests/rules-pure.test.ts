import { test } from "node:test";
import assert from "node:assert/strict";
import { addRule, describeAction, describeTrigger, lastSlot, nextRun, parseRule, ruleBlocked, ruleDue, type ParsedRule, type RuleSchedule } from "../src/lib/rules-pure.ts";

const ok = (t: string) => { const p = parseRule(t); if ("error" in p) assert.fail(`${t}: ${p.error}`); return p as ParsedRule; };
const sched = (t: string) => { const p = ok(t); assert.equal(p.trigger.type, "schedule", t); return (p.trigger as { schedule: RuleSchedule }).schedule; };

test("the roadmap's three examples", () => {
  const review = ok("Prepare my weekly project review on Sunday");
  assert.deepEqual(review.trigger, { type: "schedule", schedule: { days: [0], hour: 9, minute: 0 } });
  assert.deepEqual(review.action, { kind: "orbit", id: "week_review" });
  const deals = ok("Every weekday 7:30 check deals");
  assert.deepEqual(deals.trigger, { type: "schedule", schedule: { days: [1, 2, 3, 4, 5], hour: 7, minute: 30 } });
  assert.deepEqual(deals.action, { kind: "orbit", id: "deals" });
  assert.equal(deals.name, "Check deals");
  const reply = ok("When a client replies, draft an answer");
  assert.deepEqual(reply.trigger, { type: "event", event: "client.replied" });
  assert.deepEqual(reply.action, { kind: "agent", agent: "forge", prompt: "Draft an answer" });
  assert.match(reply.scope, /client's BUSINESS entry/);
  assert.ok(reply.permissions.some((p) => /Approvals/.test(p)));
});

test("English schedules: days, times, am/pm, daily default", () => {
  assert.deepEqual(sched("every Monday and Thursday at 6pm research AI chips"), { days: [1, 4], hour: 18, minute: 0 });
  assert.deepEqual(sched("At 7:30 check the news"), { days: [0, 1, 2, 3, 4, 5, 6], hour: 7, minute: 30 });
  assert.deepEqual(sched("every morning summarise my notes"), { days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 });
  assert.deepEqual(sched("on weekends at 12am watch Roblox news"), { days: [0, 6], hour: 0, minute: 0 });
  assert.deepEqual(sched("weekly: write a short progress note"), { days: [1], hour: 9, minute: 0 });
  assert.deepEqual(sched("Sundays 18:00 prepare my weekly project review"), { days: [0], hour: 18, minute: 0 });
  const p = ok("research AI chips every Monday and Thursday at 6pm");
  assert.deepEqual(p.action, { kind: "agent", agent: "atlas", prompt: "Research AI chips" });
  assert.equal(ok("every Friday at 16:00 check the news").action.kind === "agent" && (ok("every Friday at 16:00 check the news").action as { agent: string }).agent, "pulse");
});

test("Estonian", () => {
  const d = ok("Iga tööpäev kell 7.30 kontrolli pakkumisi");
  assert.deepEqual(d.trigger, { type: "schedule", schedule: { days: [1, 2, 3, 4, 5], hour: 7, minute: 30 } });
  assert.deepEqual(d.action, { kind: "orbit", id: "deals" });
  const w = ok("Pühapäeval kell 18 valmista nädala ülevaade");
  assert.deepEqual(w.trigger, { type: "schedule", schedule: { days: [0], hour: 18, minute: 0 } });
  assert.deepEqual(w.action, { kind: "orbit", id: "week_review" });
  const k = ok("Kui klient vastab, koosta vastus");
  assert.deepEqual(k.trigger, { type: "event", event: "client.replied" });
  assert.deepEqual(k.action, { kind: "agent", agent: "forge", prompt: "Koosta vastus" });
  assert.deepEqual(sched("Igal hommikul uuri Roblox uudiseid"), { days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 });
});

test("events, skills, missions; action-first order", () => {
  assert.deepEqual(ok("Draft an answer when a client replies").trigger, { type: "event", event: "client.replied" });
  assert.deepEqual(ok("Whenever a briefing is ready, pick the 3 stories for my channel").trigger, { type: "event", event: "briefing.ready" });
  assert.deepEqual(ok("When you find a great deal, research the seller").trigger, { type: "event", event: "deal.found" });
  assert.equal(ok("When you find a great deal, research the seller").action.kind, "agent"); // a deal event never re-runs the hunter
  assert.deepEqual(ok("when I save a note, organise it with my other notes").trigger, { type: "event", event: "memory.created" });
  assert.deepEqual(ok("every Friday run skill weekly recap: last 7 days").action, { kind: "skill", name: "weekly recap", input: "last 7 days" });
  assert.deepEqual(ok("every Monday start a mission: find 5 cafes in Tartu without online booking").action, { kind: "mission", objective: "Find 5 cafes in Tartu without online booking" });
});

test("clear errors instead of guesses", () => {
  assert.match((parseRule("check deals") as { error: string }).error, /Say when/);
  assert.match((parseRule("every day at 25:00 check deals") as { error: string }).error, /time/);
  assert.match((parseRule("every day at 9") as { error: string }).error, /Say what/);
  assert.match((parseRule("") as { error: string }).error, /sentence/);
});

test("next-run math: weekdays, week wrap, same-day, DST-safe local times", () => {
  const wd: RuleSchedule = { days: [1, 2, 3, 4, 5], hour: 7, minute: 30 };
  const fri = new Date(2026, 9, 30, 8, 0); // Friday 30 Oct 2026, 08:00
  assert.deepEqual(nextRun(wd, fri), new Date(2026, 10, 2, 7, 30)); // → Monday
  assert.deepEqual(nextRun(wd, new Date(2026, 9, 30, 7, 0)), new Date(2026, 9, 30, 7, 30)); // later today
  assert.deepEqual(nextRun(wd, new Date(2026, 9, 30, 7, 30)), new Date(2026, 10, 2, 7, 30)); // strictly after
  const sun: RuleSchedule = { days: [0], hour: 9, minute: 0 };
  assert.deepEqual(nextRun(sun, new Date(2026, 10, 1, 9, 1)), new Date(2026, 10, 8, 9, 0)); // just missed → next week
  assert.deepEqual(lastSlot(sun, new Date(2026, 10, 1, 9, 1)), new Date(2026, 10, 1, 9, 0));
  assert.deepEqual(nextRun(sun, new Date(2026, 2, 28, 12, 0)), new Date(2026, 2, 29, 9, 0)); // across the EU spring DST change
  assert.equal(nextRun({ days: [], hour: 9, minute: 0 }, fri), null);
});

test("ruleDue: once per slot, not before activation, catch-up within grace", () => {
  const s: RuleSchedule = { days: [1, 2, 3, 4, 5], hour: 7, minute: 30 };
  const mon = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
  const since = new Date(2026, 9, 1).toISOString();
  assert.equal(ruleDue(s, null, since, mon(7, 30)), true);
  assert.equal(ruleDue(s, mon(7, 30).toISOString(), since, mon(7, 31)), false); // already ran this slot
  assert.equal(ruleDue(s, null, since, mon(10, 0)), true); // PC woke at 10: catch up
  assert.equal(ruleDue(s, null, since, mon(11, 0)), false); // past the 3 h grace
  assert.equal(ruleDue(s, null, mon(8, 0).toISOString(), mon(9, 0)), false); // confirmed after today's slot
  assert.equal(ruleDue(s, null, null, mon(7, 30)), false); // proposed, never confirmed
});

test("descriptions, adding, CORE guard", () => {
  assert.equal(describeTrigger({ type: "schedule", schedule: { days: [1, 2, 3, 4, 5], hour: 7, minute: 30 } }), "Every weekday at 07:30");
  assert.equal(describeTrigger({ type: "schedule", schedule: { days: [1, 4], hour: 18, minute: 0 } }), "Every Monday and Thursday at 18:00");
  assert.equal(describeTrigger({ type: "event", event: "client.replied" }), "When a client replies");
  assert.equal(describeAction({ kind: "orbit", id: "deals" }), "Check the deal hunter's wishlist");
  const p = ok("Every weekday 7:30 check deals");
  const a = addRule([], "Every weekday 7:30 check deals", p, "owner", "r1", "2026-10-27T10:00:00.000Z");
  assert.ok(Array.isArray(a) && a[0].status === "active" && a[0].activeSince);
  const c = addRule([], "x every day", p, "core", "r2", "2026-10-27T10:00:00.000Z");
  assert.ok(Array.isArray(c) && c[0].status === "proposed" && c[0].activeSince === null); // CORE proposes; he confirms
  assert.equal(addRule(a as never, "every weekday 7:30 check deals ", p, "owner", "r3", ""), "That rule already exists");
  assert.equal(ruleBlocked("every Sunday prepare my weekly review", false), "");
  assert.equal(ruleBlocked("kui klient vastab, koosta vastus", false), "");
  assert.notEqual(ruleBlocked("every Sunday prepare my weekly review", true), "");
  assert.notEqual(ruleBlocked("what's the weather", false), "");
});
