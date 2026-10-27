import { test } from "node:test";
import assert from "node:assert/strict";
import { backedOff, habitWeek, ignoredRun, median, nudgeMinute, parseWindow, recordAt, shouldNudge, windowLabel, MAX_AT } from "../src/lib/habit-nudge-pure.ts";
import { addDays, streak, weekday, type Habit } from "../src/lib/life-pure.ts";
import { composeBrief, type BriefIn } from "../src/lib/brief-pure.ts";
import { NonceCache, parseCommand } from "../src/lib/remote-pure.ts";
import { actionFor } from "../src/lib/remote-web-pure.ts";

const MON = "2026-10-26"; // a Monday
const ctx = { quiet: false, focus: false, stop: false };
const H = (o: Partial<Habit> = {}): Habit => ({ id: "h", name: "Stretch", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: "2026-01-01", done: [], window: { from: 19 * 60, to: 22 * 60 }, nudge: "toast", ...o });

test("parseWindow: ranges, presets, days", () => {
  assert.deepEqual(parseWindow("evening 19–22"), { window: { from: 1140, to: 1320 } });
  assert.deepEqual(parseWindow("after lunch"), { window: { from: 780, to: 900 } });
  assert.deepEqual(parseWindow("on Mondays"), { window: { from: 540, to: 1260 }, days: [1] });
  assert.deepEqual(parseWindow("mon wed 7:30-8"), { window: { from: 450, to: 480 }, days: [1, 3] });
  assert.deepEqual(parseWindow("weekdays morning")?.days, [1, 2, 3, 4, 5]);
  for (const bad of ["", "whenever", "22-19", "19:75-20", "10-25", 5, "x".repeat(61)]) assert.equal(parseWindow(bad), null, String(bad));
  assert.equal(windowLabel({ from: 1140, to: 1320 }), "19:00–22:00");
});

test("median and timing model: same weekday first, else all, else window start; 10 min early, clamped", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3); // rounds .5 up
  assert.equal(nudgeMinute(H(), MON), 1140); // no history
  assert.equal(nudgeMinute(H({ window: undefined }), MON), null);
  // Mondays at 20:30 and 20:40, other days at 21:30: Monday nudges at 20:25, Tuesday (one sample) from all four (median 21:05) → 20:55
  const at = { "2026-10-12": 1230, "2026-10-19": 1240, "2026-10-20": 1290, "2026-10-21": 1290 };
  assert.equal(nudgeMinute(H({ at }), MON), 1225);
  assert.equal(nudgeMinute(H({ at }), "2026-10-27"), 1255);
  // outside the window is ignored; early usual time clamps to the window start
  assert.equal(nudgeMinute(H({ at: { "2026-10-19": 600, "2026-10-12": 1141, "2026-10-05": 1142 } }), MON), 1140);
});

test("recordAt keeps one minute per day, newest MAX_AT, and clears on undo", () => {
  let at = recordAt(undefined, MON, 1200);
  assert.deepEqual(at, { [MON]: 1200 });
  assert.deepEqual(recordAt(at, MON, null), {});
  for (let i = 1; i <= MAX_AT + 5; i++) at = recordAt(at, addDays(MON, i), i);
  assert.equal(Object.keys(at).length, MAX_AT);
  assert.ok(!(MON in at) && addDays(MON, MAX_AT + 5) in at); // oldest dropped
});

test("back-off: 2 ignored in a row → one try a week; a check-in resets", () => {
  const h = H({ nudged: "2026-10-24", ignored: 1 }); // Saturday nudge ignored, one before that too
  assert.equal(ignoredRun(h, "2026-10-24"), 1); // its day isn't over yet
  assert.equal(ignoredRun(h, MON), 2);
  assert.equal(backedOff(h, MON), true);
  assert.equal(backedOff(h, "2026-10-31"), false); // a week later, one more try
  assert.equal(ignoredRun({ ...h, done: ["2026-10-25"] }, MON), 0); // checked in after it
  assert.equal(ignoredRun({ ...h, ignored: 0 }, MON), 1);
  assert.equal(backedOff({ ...h, ignored: 0 }, MON), false);
});

test("shouldNudge: window, done, once a day, scheduled days, quiet/focus/stop-all", () => {
  const h = H();
  assert.equal(shouldNudge(h, MON, 1139, ctx), false);
  assert.equal(shouldNudge(h, MON, 1140, ctx), true);
  assert.equal(shouldNudge(h, MON, 1320, ctx), false); // window over
  assert.equal(shouldNudge(H({ done: [MON] }), MON, 1200, ctx), false);
  assert.equal(shouldNudge(H({ nudged: MON }), MON, 1200, ctx), false);
  assert.equal(shouldNudge(H({ days: [2] }), MON, 1200, ctx), false);
  assert.equal(shouldNudge(H({ nudge: undefined }), MON, 1200, ctx), false);
  for (const k of ["quiet", "focus", "stop"] as const) assert.equal(shouldNudge(h, MON, 1200, { ...ctx, [k]: true }), false, k);
  assert.equal(shouldNudge(H({ nudged: "2026-10-24", ignored: 1 }), MON, 1200, ctx), false); // backed off
});

test("streak math still holds with nudge fields; weekly counts are last Mon–Sun", () => {
  assert.equal(streak(H({ done: ["2026-10-24", "2026-10-25"] }), MON), 2);
  const week = ["2026-10-19", "2026-10-20", "2026-10-21"];
  const hs = [H({ done: week }), H({ days: [1], done: ["2026-10-19"] }), H({ created: "2026-10-25", done: [] })];
  assert.deepEqual(habitWeek(hs, MON), { done: 4, due: 7 + 1 + 1 });
  assert.deepEqual(habitWeek(hs, "2026-11-01"), { done: 4, due: 9 }); // Sunday: still the week before
});

test("brief: weekly habit line on Mondays, counts only, spoken only with LIFE opt-in", () => {
  const base: BriefIn = { day: MON, hour: 8, life: false, morning: {} as BriefIn["morning"], decisions: [], replies: [], snoozed: [], habits: { done: 9, due: 12 } };
  const b = composeBrief(base);
  assert.equal(weekday(MON), 1);
  assert.equal(b.items[0].title, "Habits last week: 9/12");
  assert.ok(!/habit/i.test(b.spoken));
  assert.match(composeBrief({ ...base, life: true }).spoken, /kept nine of 12 habit check-ins/);
  assert.equal(composeBrief({ ...base, day: "2026-10-27" }).items.length, 0);
});

test("remote: habit.done takes a uuid id and maps to habitDone", () => {
  const id = "3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
  const r = parseCommand(JSON.stringify({ type: "habit.done", nonce: "n".repeat(20), id }), new NonceCache());
  assert.ok(r.ok);
  if (r.ok) assert.equal(actionFor(r.cmd), "habitDone");
  assert.equal(parseCommand(JSON.stringify({ type: "habit.done", nonce: "m".repeat(20), id: "Stretch" }), new NonceCache()).ok, false);
});
