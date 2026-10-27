import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS, archLink, dueMs, emptyStore, freeSlots, parseStore, patchSettings, planSchool, prepDue, prepText, schoolBrief, validateItem, weekKey,
  type SchoolItem, type SchoolStore,
} from "../src/lib/school-pure.ts";

// Local-time helpers so the tests pass in any TZ. 2026-11-02 is a Monday.
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();
const H = 3_600_000;
const item = (o: Partial<SchoolItem>): SchoolItem => ({ id: "a", courseId: "", kind: "assignment", title: "Site analysis", due: "2026-11-06", hours: 4, ...o });
const store = (items: SchoolItem[], s = {}): SchoolStore => ({ ...emptyStore(), items, settings: { ...DEFAULTS, ...s } });
const hours = (bs: { start: number; end: number }[]) => bs.reduce((n, b) => n + (b.end - b.start) / H, 0);

test("due dates parse as local times; bad ones are NaN", () => {
  assert.equal(dueMs("2026-11-06"), at(6, 23, 59));
  assert.equal(dueMs("2026-11-06T09:30"), at(6, 9, 30));
  assert.ok(Number.isNaN(dueMs("2026-02-30")));
  assert.ok(Number.isNaN(dueMs("6.11.2026")));
  assert.equal(weekKey(at(8, 12)), "2026-11-02", "Sunday belongs to the week starting Monday");
});

test("free slots: study window only, never quiet hours or busy times", () => {
  const s = { ...DEFAULTS, weekday: ["07:00", "23:30"] as [string, string] };
  const slots = freeSlots(at(2, 0), at(3, 0), s, [{ start: at(2, 17), end: at(2, 18) }]);
  const hrs = slots.map((t) => new Date(t).getHours() + new Date(t).getMinutes() / 60);
  assert.equal(hrs[0], 8, "quiet hours end at 08:00");
  assert.equal(hrs[hrs.length - 1], 22.5, "last slot ends by 23:00");
  assert.ok(!hrs.includes(17) && !hrs.includes(17.5), "busy hour skipped");
  assert.equal(slots.length, (23 - 8) * 2 - 2);
});

test("backward scheduling: as late as possible before due minus the buffer", () => {
  const p = planSchool(store([item({ hours: 3 })]), at(2, 9)); // due Fri 6th, buffer 1 day → by Thu 23:59
  assert.equal(hours(p.blocks), 3);
  assert.deepEqual(p.blocks.map((b) => [new Date(b.start).getDate(), new Date(b.start).getHours(), new Date(b.end).getHours()]), [[5, 19, 22]]);
  assert.deepEqual(p.short, {});
});

test("respects the per-day cap and busy calendar, spills earlier", () => {
  const p = planSchool(store([item({ hours: 6 })], { maxDay: 2 }), at(2, 9), [{ start: at(5, 20), end: at(5, 22) }]);
  const byDay = new Map<number, number>();
  for (const b of p.blocks) byDay.set(new Date(b.start).getDate(), (byDay.get(new Date(b.start).getDate()) ?? 0) + (b.end - b.start) / H);
  assert.deepEqual([...byDay.entries()].sort(), [[3, 2], [4, 2], [5, 2]]);
  assert.ok(p.blocks.every((b) => !(b.start < at(5, 22) && b.end > at(5, 20))), "no block on the calendar event");
});

test("two deadlines share time: the later one goes late, the earlier one still fits", () => {
  const p = planSchool(store([item({ id: "early", due: "2026-11-04", hours: 4 }), item({ id: "late", due: "2026-11-06", hours: 4 })], { maxDay: 4, bufferDays: 0 }), at(2, 9));
  const of = (id: string) => p.blocks.filter((b) => b.itemId === id);
  assert.equal(hours(of("early")), 4); assert.equal(hours(of("late")), 4);
  assert.ok(of("early").every((b) => b.end <= dueMs("2026-11-04")));
  assert.ok(of("late").every((b) => new Date(b.start).getDate() >= 5), "the later one sits right before its own deadline");
});

test("too much work: short hours and an overloaded week", () => {
  const p = planSchool(store([item({ id: "x", hours: 30, due: "2026-11-04" })], { maxDay: 4 }), at(2, 9));
  assert.ok(p.short.x > 0);
  const w = p.weeks.find((x) => x.week === "2026-11-02")!;
  assert.equal(w.over, true);
  assert.equal(w.deadlines, 1);
  // Heavy but feasible: more than maxWeek planned in one week.
  const q = planSchool(store([item({ id: "y", hours: 24, due: "2026-11-08" })], { maxDay: 6, maxWeek: 20, bufferDays: 0 }), at(2, 9));
  assert.deepEqual(q.short, {});
  assert.equal(q.weeks.find((x) => x.week === "2026-11-02")!.over, true);
  // Done, past or zero-hour items aren't planned.
  assert.equal(planSchool(store([item({ done: true }), item({ id: "b", due: "2026-11-01" }), item({ id: "c", hours: 0 })]), at(2, 9)).blocks.length, 0);
});

test("brief line: overload first, then today's hours, then the next deadline; never a title in the spoken words", () => {
  const over = store([item({ id: "x", hours: 30, due: "2026-11-04", title: "SECRET TITLE" })]);
  const b1 = schoolBrief(over, planSchool(over, at(2, 9)), at(2, 9))!;
  assert.match(b1.id, /^school:over:2026-11-02$/);
  assert.match(b1.say, /overloaded/);
  assert.ok(!b1.say.includes("SECRET"));
  const today = store([item({ hours: 2, due: "2026-11-03", title: "SECRET TITLE" })], { bufferDays: 0 });
  const b2 = schoolBrief(today, planSchool(today, at(3, 8)), at(3, 8))!;
  assert.equal(b2.id, "school:2026-11-03");
  assert.match(b2.say, /2 hours planned today, starting at 20:00/);
  assert.ok(!b2.say.includes("SECRET") && b2.detail?.includes("SECRET"));
  const due = store([item({ hours: 0, due: "2026-11-05" })]);
  assert.match(schoolBrief(due, planSchool(due, at(2, 9)), at(2, 9))!.say, /next school deadline is on Thursday/);
  assert.equal(schoolBrief(store([]), planSchool(store([]), at(2, 9)), at(2, 9)), null);
});

test("validation, settings, parse, ARCH links, night prep", () => {
  const now = at(2, 9);
  assert.equal(typeof validateItem({ title: "", kind: "exam", due: "2026-11-06", hours: 2 }, [], now), "string");
  assert.equal(typeof validateItem({ title: "x", kind: "party", due: "2026-11-06", hours: 2 }, [], now), "string");
  assert.equal(typeof validateItem({ title: "x", kind: "exam", due: "2026-11-06", hours: 2, courseId: "nope" }, [], now), "string");
  assert.equal(typeof validateItem({ title: "x", kind: "exam", due: "2030-01-01", hours: 2 }, [], now), "string");
  assert.deepEqual(validateItem({ title: " Structures  I ", kind: "exam", due: "2026-11-06T10:00", hours: 7.3, courseId: "c" }, [{ id: "c", name: "Structures" }], now),
    { courseId: "c", kind: "exam", title: "Structures I", due: "2026-11-06T10:00", hours: 7.5 });
  assert.equal(typeof patchSettings({ weekday: ["22:00", "16:00"] }, DEFAULTS), "string");
  assert.equal(typeof patchSettings({ maxDay: 0 }, DEFAULTS), "string");
  assert.deepEqual((patchSettings({ weekend: ["09:00", "18:00"], maxWeek: 25 }, DEFAULTS) as typeof DEFAULTS).weekend, ["09:00", "18:00"]);
  const parsed = parseStore({ items: [item({}), { id: "bad", title: "x", kind: "exam", due: "nope", hours: 1 }], courses: [{ id: "c" }], settings: { maxDay: "x" } });
  assert.equal(parsed.items.length, 1); assert.equal(parsed.courses.length, 0); assert.deepEqual(parsed.settings, DEFAULTS);
  assert.equal(typeof archLink(null, now), "string");
  assert.equal(typeof archLink({ parts: [{ x: "y".repeat(25_000) }] }, now), "string");
  assert.equal((archLink({ plot: {}, parts: [1, 2] }, now) as { parts: number }).parts, 2);
  const its = [item({ id: "soon" }), item({ id: "far", due: "2027-01-20" }), item({ id: "q", prepped: "2026-11-01" })];
  assert.deepEqual(prepDue(its, now).map((i) => i.id), ["soon"]);
  const t = prepText(item({ kind: "studio", title: "Pavilion" }), { id: "c", name: "Studio 1" });
  assert.ok(t.length <= 500 && t.includes("Pavilion") && t.includes("Studio 1"));
});
