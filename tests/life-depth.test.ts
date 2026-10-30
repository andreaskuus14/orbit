// LIF04 habits beyond streaks, LIF06 school workflow, LIF08 weekly review, LIF13 plan explanations + deferral.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, applyHabitPlan, dueToday, emptyStore, habitPlanPatch, isOff, recordAmount, streak, trend, view, weekRates, weekStart, type Habit } from "../src/lib/life-pure.ts";
import { shouldNudge } from "../src/lib/habit-nudge-pure.ts";
import { weekReview } from "../src/lib/life-week-pure.ts";
import { applyDeferrals, buildPlan, dayStat, defer, deferUntil, whyOf, type PlanItem } from "../src/lib/dayplan-pure.ts";
import { cleanSources, isEstonian, nextStep, prepText, type Plan, type SchoolItem } from "../src/lib/school-pure.ts";

const MON = "2026-10-26"; // a Monday
const H = (p: Partial<Habit> = {}): Habit => ({ id: "h1", name: "Read", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: "2026-09-01", done: [], ...p });

test("LIF04: a pause or rest day never breaks a streak and isn't expected", () => {
  const today = addDays(MON, 4); // Friday
  const done = [MON, addDays(MON, 1), addDays(MON, 3)]; // Wednesday missed
  assert.equal(streak(H({ done }), today), 1);
  assert.equal(streak(H({ done, rest: [addDays(MON, 2)] }), today), 3);
  assert.equal(streak(H({ done, pauses: [{ from: addDays(MON, 2), to: addDays(MON, 2) }] }), today), 3);
  assert.ok(isOff(H({ pauses: [{ from: MON, to: today }] }), today));
  assert.equal(dueToday(H({ pauses: [{ from: MON, to: today }] }), today), false);
});

test("LIF04: weekly target: due until met, streak counts weeks that met it", () => {
  const h = H({ target: 3, done: [addDays(MON, -7), addDays(MON, -5), addDays(MON, -3), MON, addDays(MON, 2)] });
  assert.equal(dueToday(h, addDays(MON, 3)), true); // 2 of 3 so far
  assert.equal(streak(h, addDays(MON, 3)), 1); // last week met, this week not yet (doesn't break)
  const met = { ...h, done: [...h.done, addDays(MON, 3)] };
  assert.equal(dueToday(met, addDays(MON, 4)), false);
  assert.equal(streak(met, addDays(MON, 4)), 2);
  assert.equal(dueToday(met, addDays(MON, 3)), true, "the day that meets it still shows as today's");
});

test("LIF04: quantity habits record amounts; done only at the goal", () => {
  const h = H({ unit: "pages", goal: 20 });
  assert.equal(recordAmount(h, MON, 12), false);
  assert.equal(h.qty?.[MON], 12);
  assert.equal(recordAmount(h, MON, 25), true);
  recordAmount(h, MON, 0);
  assert.equal(h.qty?.[MON], undefined);
});

test("LIF04: plan patch validation and apply", () => {
  assert.equal(typeof habitPlanPatch({ target: 9 }), "string");
  assert.equal(typeof habitPlanPatch({ unit: "", goal: 3 }), "string");
  assert.equal(typeof habitPlanPatch({ pause: { from: "2026-11-10", to: "2026-11-01" } }), "string");
  const h = H();
  const p = habitPlanPatch({ target: 3, unit: "km", goal: 5, pause: { from: "2026-11-01", to: "2026-11-07" } });
  assert.ok(typeof p !== "string");
  applyHabitPlan(h, p, MON);
  assert.deepEqual([h.target, h.unit, h.goal, h.pauses?.length], [3, "km", 5, 1]);
  applyHabitPlan(h, { target: null, unit: null, rest: MON }, MON);
  assert.deepEqual([h.target, h.unit, h.goal, h.rest], [undefined, undefined, undefined, [MON]]);
  applyHabitPlan(h, { rest: MON }, MON);
  assert.equal(h.rest, undefined, "rest toggles off");
  applyHabitPlan(h, { pause: null }, "2026-11-03");
  assert.deepEqual(h.pauses, [{ from: "2026-11-01", to: "2026-11-02" }], "ending a pause keeps the days already taken");
});

test("LIF04: trend is neutral and needs both halves", () => {
  assert.equal(trend([null, null, 1, 1]), "new");
  assert.equal(trend([0.2, 0.2, 0.9, 0.9]), "up");
  assert.equal(trend([1, 1, 0.3, 0.3]), "down");
  assert.equal(trend([0.7, 0.7, 0.75, 0.7]), "steady");
  const rates = weekRates(H({ days: [1], done: [addDays(MON, -7), addDays(MON, -14)], created: addDays(MON, -28) }), MON);
  assert.deepEqual(rates, [0, 0, 1, 1]);
});

test("LIF04: nudges stay quiet on off days and after the weekly target", () => {
  const ctx = { quiet: false, focus: false, stop: false };
  const base = H({ window: { from: 600, to: 700 }, nudge: "toast" });
  assert.equal(shouldNudge(base, MON, 650, ctx), true);
  assert.equal(shouldNudge({ ...base, rest: [MON] }, MON, 650, ctx), false);
  assert.equal(shouldNudge({ ...base, target: 1, done: [addDays(MON, 1)] }, addDays(MON, 2), 650, ctx), false);
});

test("LIF04: view exposes week progress, off and trend; old data still works", () => {
  const s = emptyStore();
  s.habits.push(H({ target: 2, done: [] }), { id: "old", name: "Old", emoji: "", days: [1], created: "2026-01-01", done: [] });
  const v = view(s, new Date(`${MON}T12:00:00`).getTime());
  assert.equal(v.habits[0].weekDone, 0);
  assert.equal(v.habits[0].off, false);
  assert.equal(v.habits[1].scheduledToday, true);
  assert.equal(weekStart(MON), MON);
});

test("LIF08: weekly review: outcomes, accuracy, friction, one habit, explicit gaps, never the journal", () => {
  const life = { ...emptyStore(), journal: { [MON]: "SECRET DIARY TEXT" }, focus: { [MON]: 50 },
    habits: [H({ id: "a", name: "Run", done: [MON] }), H({ id: "b", name: "Stretch", days: [1, 3], done: [MON, addDays(MON, 2)] })] };
  const r = weekReview({ life, today: addDays(MON, 6), school: [{ title: "Essee", done: true, doneAt: `${addDays(MON, 2)}T10:00:00Z` }],
    history: [{ day: MON, plannedMin: 120, doneMin: 60, planned: 3, done: 1, missed: ["Tax form", "Email"] }, { day: addDays(MON, 1), plannedMin: 60, doneMin: 60, planned: 1, done: 1, missed: ["Tax form"] }],
    deferred: [{ id: "x", title: "Email", until: addDays(MON, 3), n: 1, at: `${addDays(MON, 1)}T08:00:00Z` }] });
  assert.equal(JSON.stringify(r).includes("SECRET"), false);
  assert.deepEqual(r.accuracy, { plannedMin: 180, doneMin: 120, pct: 67, days: 2 });
  assert.equal(r.outcomes.tasksDone, 2);
  assert.deepEqual(r.outcomes.schoolDone, ["Essee"]);
  assert.deepEqual(r.friction.map((f) => f.title), ["Tax form", "Email"]);
  assert.equal(r.adjust?.name, "Run");
  assert.deepEqual(r.missing, []);
  const empty = weekReview({ life: emptyStore(), today: MON, history: [], deferred: [], school: null });
  assert.deepEqual(empty.missing, ["plans", "habits", "focus", "school"]);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.adjust, null);
});

test("LIF13: each block says why, whose estimate and its deadline", () => {
  const src = { kind: "commitment" as const, label: "Commitment inbox" };
  const items: PlanItem[] = [
    { id: "a", title: "Overdue", min: 30, flexible: true, due: "2026-10-25", source: src, est: "own" },
    { id: "b", title: "Soon", min: 30, flexible: true, due: "2026-10-28", source: src },
    { id: "c", title: "Meeting", min: 60, flexible: false, fixed: { start: 600, end: 660 }, source: { kind: "calendar", label: "Google Calendar" } },
  ];
  assert.deepEqual(whyOf(items[0], MON), { r: "overdue", est: "own", due: "2026-10-25" });
  assert.deepEqual(whyOf(items[1], MON), { r: "dueSoon", est: "orbit", due: "2026-10-28" });
  const p = buildPlan(items, { day: MON, now: 480, personal: null });
  assert.equal(p.blocks.find((b) => b.id === "c")?.why?.r, "fixed");
  assert.equal(p.blocks.find((b) => b.id === "c")?.why?.est, "event");
  const st = dayStat({ ...p, accepted: "x", blocks: p.blocks.map((b) => (b.id === "a" ? { ...b, done: true } : b)) });
  assert.deepEqual([st?.planned, st?.done, st?.missed], [2, 1, ["Soon"]]);
});

test("LIF13: deferral keeps the same task out until its day, also when re-captured", () => {
  assert.equal(deferUntil(MON, "tomorrow"), "2026-10-27");
  assert.equal(deferUntil(MON, "week"), "2026-11-02");
  assert.equal(deferUntil("2026-11-01", "week"), "2026-11-02"); // Sunday → the next day's Monday
  let d = defer([], { id: "a", title: "Call bank" }, "2026-10-27", "2026-10-26T08:00:00Z");
  d = defer(d, { id: "b", title: "call  bank" }, "2026-10-28", "2026-10-27T08:00:00Z");
  assert.equal(d.length, 1);
  assert.equal(d[0].n, 2);
  const items: PlanItem[] = [{ id: "z", title: "Call bank", min: 30, flexible: true, source: { kind: "commitment", label: "x" } },
    { id: "cal", title: "Call bank", min: 30, flexible: false, fixed: { start: 1, end: 2 }, source: { kind: "calendar", label: "x" } }];
  assert.deepEqual(applyDeferrals(items, d, "2026-10-27").map((i) => i.id), ["cal"]);
  assert.equal(applyDeferrals(items, d, "2026-10-28").length, 2);
});

test("LIF06: school next action, VAULT sources, Estonian material", () => {
  const now = new Date("2026-10-26T09:00:00").getTime();
  const it: SchoolItem = { id: "i", courseId: "", kind: "assignment", title: "Essee: Tallinna vanalinn", due: "2026-11-05", hours: 4 };
  const plan: Plan = { blocks: [{ itemId: "i", start: now + 3_600_000, end: now + 7_200_000 }], short: {}, weeks: [] };
  assert.deepEqual(nextStep(it, plan, now), { kind: "sources" });
  const withSrc = { ...it, sources: ["3f1c9a2e-0000-4000-8000-000000000001"] };
  assert.deepEqual(nextStep(withSrc, plan, now), { kind: "block", at: now + 3_600_000 });
  assert.deepEqual(nextStep({ ...withSrc, next: "Loe 2. peatükk" }, plan, now), { kind: "own", text: "Loe 2. peatükk" });
  assert.deepEqual(nextStep(withSrc, { ...plan, short: { i: 2 } }, now), { kind: "short", hours: 2 });
  assert.deepEqual(nextStep({ ...withSrc, kind: "exam", due: "2026-10-29" }, plan, now), { kind: "cards" });
  assert.deepEqual(cleanSources(["abcdefgh-1", "abcdefgh-1"]), ["abcdefgh-1"]);
  assert.equal(typeof cleanSources(["../etc/passwd"]), "string");
  assert.equal(isEstonian("Arhitektuuri ajalugu"), true);
  assert.equal(isEstonian("Structural design"), false);
  assert.match(prepText(it), /Estonian sources/);
  assert.doesNotMatch(prepText({ ...it, title: "Structural design report" }), /Estonian/);
  assert.ok(prepText({ ...it, title: "x".repeat(120) }, { id: "c", name: "õ".repeat(80) }).length <= 500);
});
