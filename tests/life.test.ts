import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, weekday, weekStart, isDateKey, streak, last7, matchHabit, reminderTimeError, dueReminders, visibleReminders, pruneReminders,
  cleanName, cleanEmoji, cleanDays, view, summaryText, emptyStore, ALL_DAYS, journalText, nextOccurrence, isRepeat, type Habit,
} from "../src/lib/life-pure.ts";

test("date keys step whole days, across month/year and DST", () => {
  assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // EU DST start (Mar 29)
  assert.equal(addDays("2026-03-08", 1), "2026-03-09"); // US DST start
  assert.equal(addDays("2026-10-25", -1), "2026-10-24"); // EU DST end
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(weekday("2026-10-16"), 5); // Friday
  assert.equal(weekStart("2026-10-18"), "2026-10-12"); // Sunday → Monday before
  assert.equal(weekStart("2026-10-12"), "2026-10-12");
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2026-10-16"), true);
  assert.equal(isDateKey("x"), false);
});

const h = (done: string[], days = ALL_DAYS, created = "2026-01-01") => ({ days, done, created });

test("streak rules", () => {
  const today = "2026-10-16"; // Friday
  assert.equal(streak(h([]), today), 0);
  assert.equal(streak(h(["2026-10-16", "2026-10-15", "2026-10-14"]), today), 3);
  assert.equal(streak(h(["2026-10-15", "2026-10-14"]), today), 2, "today not done yet doesn't break");
  assert.equal(streak(h(["2026-10-16", "2026-10-14"]), today), 1, "a missed past day breaks");
  // Weekdays only (Mon–Fri): the weekend is skipped.
  const wk = [1, 2, 3, 4, 5];
  assert.equal(streak(h(["2026-10-12", "2026-10-09", "2026-10-08"], wk), "2026-10-12"), 3);
  assert.equal(streak(h(["2026-10-09", "2026-10-08"], wk), "2026-10-11"), 2, "Sunday unscheduled");
  // Across DST (EU Oct 25).
  assert.equal(streak(h(["2026-10-24", "2026-10-25", "2026-10-26"]), "2026-10-26"), 3);
  assert.equal(streak(h(["2026-10-16"], []), today), 0);
  assert.equal(streak(h(["2026-10-16", "2026-10-15"], ALL_DAYS, "2026-10-15"), today), 2, "stops at creation");
});

test("last7 dots", () => {
  const dots = last7({ days: [1, 2, 3, 4, 5], done: ["2026-10-16"] }, "2026-10-16");
  assert.equal(dots.length, 7);
  assert.deepEqual(dots[6], { date: "2026-10-16", scheduled: true, done: true });
  assert.equal(dots[0].date, "2026-10-10");
  assert.equal(dots[0].scheduled, false); // Saturday
});

test("matchHabit by id, name, unique prefix", () => {
  const hs = [{ id: "a1", name: "Read" }, { id: "b2", name: "Run" }, { id: "c3", name: "Meditate" }];
  assert.equal(matchHabit(hs, "b2")?.name, "Run");
  assert.equal(matchHabit(hs, "read")?.id, "a1");
  assert.equal(matchHabit(hs, "med")?.id, "c3");
  assert.equal(matchHabit(hs, "r"), null, "ambiguous prefix");
  assert.equal(matchHabit(hs, "swim"), null);
  assert.equal(matchHabit(hs, " "), null);
});

test("validation", () => {
  assert.equal(cleanName("  Drink   water "), "Drink water");
  assert.equal(cleanName("x".repeat(61)), null);
  assert.equal(cleanName(5), null);
  assert.equal(cleanEmoji(undefined), "");
  assert.equal(cleanEmoji("💧"), "💧");
  assert.equal(cleanEmoji("<b>"), null);
  assert.deepEqual(cleanDays(undefined), ALL_DAYS);
  assert.deepEqual(cleanDays([5, 1, 1]), [1, 5]);
  assert.equal(cleanDays([7]), null);
  assert.equal(cleanDays([]), null);
});

test("reminders", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(reminderTimeError("2026-10-16T13:00:00Z", now), null);
  assert.equal(reminderTimeError("2026-10-16T11:59:30Z", now), null, "30 s ago is fine");
  assert.match(reminderTimeError("2026-10-16T11:00:00Z", now)!, /past/);
  assert.match(reminderTimeError("2028-01-01T00:00:00Z", now)!, /year/);
  assert.match(reminderTimeError("nope", now)!, /Invalid/);
  const rs = [
    { id: "1", text: "a", at: "2026-10-16T11:00:00Z" },
    { id: "2", text: "b", at: "2026-10-16T11:30:00Z", fired: "x" },
    { id: "3", text: "c", at: "2026-10-17T11:00:00Z" },
    { id: "4", text: "d", at: "2026-10-14T11:00:00Z", fired: "x" },
    { id: "5", text: "e", at: "2026-10-14T11:00:00Z" },
  ];
  assert.deepEqual(dueReminders(rs, now).map((r) => r.id), ["1", "5"]);
  assert.deepEqual(visibleReminders(rs, now).map((r) => r.id), ["1", "2", "3"]);
  assert.deepEqual(pruneReminders(rs, now).map((r) => r.id), ["1", "2", "3", "5"]);
});

test("view + summary", () => {
  const now = new Date(2026, 9, 16, 12).getTime(); // local Fri Oct 16
  const s = emptyStore();
  const habit: Habit = { id: "1", name: "Read", emoji: "📚", days: ALL_DAYS, created: "2026-10-01", done: ["2026-10-15", "2026-10-16"] };
  s.habits.push(habit, { ...habit, id: "2", name: "Run", done: ["2026-10-15"] });
  s.focus = { "2026-10-16": 50, "2026-10-12": 25, "2026-10-11": 100 };
  s.journal = { "2026-10-15": "hi" };
  const v = view(s, now);
  assert.equal(v.today, "2026-10-16");
  assert.equal(v.habits[0].streak, 2);
  assert.equal(v.habits[1].doneToday, false);
  assert.deepEqual(v.focus, { today: 50, week: 75 });
  assert.equal(v.journal.length, 7);
  assert.equal(v.journal[1].text, "hi");
  const t = summaryText(v, now);
  assert.match(t, /1\/2 done/);
  assert.match(t, /Pending: Run \(streak 1\)/);
  assert.match(t, /Focus today: 50 min/);
  assert.ok(t.length <= 600);
});

test("journalText: last N days, newest first, weekday labels, whole-entry cap", () => {
  const j = { "2026-10-16": " today ", "2026-10-14": "wed", "2026-10-15": "  ", "2026-10-09": "too old", "2026-10-17": "future" };
  assert.equal(journalText(j, "2026-10-16", 7), "2026-10-16 (Friday): today\n2026-10-14 (Wednesday): wed");
  assert.equal(journalText(j, "2026-10-16", 1), "2026-10-16 (Friday): today");
  assert.equal(journalText({}, "2026-10-16", 7), "");
  const big = { "2026-10-16": "a".repeat(2000), "2026-10-15": "b".repeat(2000), "2026-10-14": "c".repeat(2000) };
  const out = journalText(big, "2026-10-16", 7, 4100);
  assert.ok(out.length <= 4100 + 30 && out.endsWith("(older entries omitted)") && !out.includes("c"));
});

test("nextOccurrence: same local wall-clock time, DST-safe, weekdays skip weekends, missed → next future slot", () => {
  const prevTz = process.env.TZ;
  process.env.TZ = "Europe/Berlin"; // EU DST ends Sun 2026-10-25, starts Sun 2026-03-29
  try {
    const loc = (y: number, m: number, d: number, h = 9, mi = 0) => new Date(y, m - 1, d, h, mi);
    const at = (y: number, m: number, d: number, h = 9, mi = 0) => loc(y, m, d, h, mi).toISOString();
    const just = (y: number, m: number, d: number, h = 9) => loc(y, m, d, h).getTime() + 1000; // the poll right after it was due
    // Daily across the DST-end weekend keeps 09:00 local (UTC offset changes).
    const n1 = nextOccurrence(at(2026, 10, 24), "daily", just(2026, 10, 24));
    assert.equal(n1, at(2026, 10, 25));
    assert.equal(new Date(n1).getHours(), 9);
    assert.equal(nextOccurrence(n1, "daily", just(2026, 10, 25)), at(2026, 10, 26));
    assert.equal(Date.parse(at(2026, 10, 26)) - Date.parse(at(2026, 10, 25)), 86400_000);
    assert.equal(Date.parse(at(2026, 10, 25)) - Date.parse(at(2026, 10, 24)), 90000_000, "25 h day: not +86400000");
    // DST start, plus a nonexistent local time (02:30 on Mar 29) returns to 02:30 the day after.
    assert.equal(nextOccurrence(at(2026, 3, 28, 2, 30), "daily", just(2026, 3, 28, 2)), new Date(2026, 2, 29, 2, 30).toISOString());
    assert.equal(nextOccurrence(at(2026, 3, 28, 2, 30), "daily", Date.parse(at(2026, 3, 29, 12))), at(2026, 3, 30, 2, 30));
    // Chained runs keep 02:30 when the original time is stored (not drifting to 03:30 after the skipped hour).
    const skipped = nextOccurrence(at(2026, 3, 28, 2, 30), "daily", just(2026, 3, 28, 2), "02:30");
    assert.equal(nextOccurrence(skipped, "daily", Date.parse(skipped) + 60_000, "02:30"), at(2026, 3, 30, 2, 30));
    // Weekdays: Friday → Monday; weekly: +7 days across DST.
    assert.equal(nextOccurrence(at(2026, 10, 16), "weekdays", just(2026, 10, 16)), at(2026, 10, 19));
    assert.equal(nextOccurrence(at(2026, 10, 19), "weekdays", just(2026, 10, 19)), at(2026, 10, 20));
    assert.equal(nextOccurrence(at(2026, 10, 21), "weekly", just(2026, 10, 21)), at(2026, 10, 28));
    // Missed for days (ORBIT closed): jump to the next future occurrence, no burst.
    assert.equal(nextOccurrence(at(2026, 10, 10), "daily", Date.parse(at(2026, 10, 16, 12))), at(2026, 10, 17));
    assert.equal(nextOccurrence(at(2026, 10, 10), "daily", Date.parse(at(2026, 10, 16, 8))), at(2026, 10, 16));
    assert.equal(nextOccurrence(at(2026, 10, 9), "weekdays", Date.parse(at(2026, 10, 17, 12))), at(2026, 10, 19)); // Saturday → Monday
    assert.equal(nextOccurrence(at(2026, 9, 2), "weekly", Date.parse(at(2026, 10, 16, 12))), at(2026, 10, 21)); // still Wednesdays
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
  assert.ok(isRepeat("daily") && isRepeat("weekdays") && isRepeat("weekly"));
  assert.ok(!isRepeat("hourly") && !isRepeat(undefined));
});

test("recurring reminders are never pruned and are due while their time has come", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const rs = [{ id: "r", text: "x", at: "2026-10-10T09:00:00Z", repeat: "daily" as const }];
  assert.deepEqual(pruneReminders(rs, now).map((r) => r.id), ["r"]);
  assert.deepEqual(dueReminders(rs, now).map((r) => r.id), ["r"]);
});
