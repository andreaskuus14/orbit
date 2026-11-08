// H02: Tallinn and UTC midnight boundaries, DST changes and recurring schedules against fixed dates.
// Automations use this PC's local clock, so the schedule checks run with the process in Europe/Tallinn.
process.env.TZ = "Europe/Tallinn";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRun, lastSlot, ruleDue, localDay } from "../src/lib/rules-pure.ts";
import { tallinnDayEnd } from "../src/lib/memory-types-pure.ts";

const daily = (hour: number, minute: number) => ({ days: [0, 1, 2, 3, 4, 5, 6], hour, minute });
const z = (s: string) => new Date(s); // ISO with Z
// a slot fires once per day across a window, stepping a minute at a time like the scheduler tick
function fires(s: ReturnType<typeof daily>, fromZ: string, toZ: string): string[] {
  const out: string[] = []; let last: string | null = null;
  for (let t = Date.parse(fromZ); t <= Date.parse(toZ); t += 60_000) {
    const now = new Date(t);
    if (ruleDue(s, last, "2026-01-01T00:00:00Z", now)) { last = now.toISOString(); out.push(last); }
  }
  return out;
}

test("DST end (25 Oct 2026, 04:00 → 03:00): a 03:30 daily run fires once, not in both 03:30s", () => {
  const s = daily(3, 30);
  assert.equal(nextRun(s, z("2026-10-24T10:00:00Z"))!.toISOString(), "2026-10-25T00:30:00.000Z"); // first 03:30 (still UTC+3)
  assert.deepEqual(fires(s, "2026-10-24T22:00:00Z", "2026-10-25T03:00:00Z"), ["2026-10-25T00:30:00.000Z"]);
});

test("DST start (28 Mar 2027, 03:00 → 04:00): a 03:30 daily run that doesn't exist that night still fires once", () => {
  const s = daily(3, 30);
  const runs = fires(s, "2027-03-27T22:00:00Z", "2027-03-28T05:00:00Z");
  assert.equal(runs.length, 1, JSON.stringify(runs));
  assert.equal(localDay(new Date(runs[0])), "2027-03-28");
});

test("daily runs stay at the same wall time either side of a DST change", () => {
  const s = daily(7, 30);
  const before = nextRun(s, z("2026-10-23T12:00:00Z"))!, after = nextRun(s, before)!;
  assert.deepEqual([before.getHours(), before.getMinutes(), after.getHours(), after.getMinutes()], [7, 30, 7, 30]);
  assert.equal(after.getTime() - before.getTime(), 25 * 3600_000); // 24 Oct 07:30 (UTC+3) → 25 Oct 07:30 (UTC+2) spans the long night
  const spring = nextRun(s, z("2027-03-27T12:00:00Z"))!;
  assert.equal(nextRun(s, spring)!.getTime() - spring.getTime(), 24 * 3600_000); // both after the change
  assert.equal(nextRun(s, z("2027-03-27T12:00:00Z"))!.toISOString(), "2027-03-28T04:30:00.000Z"); // 07:30 at UTC+3, already summer time
});

test("weekday-only schedule skips the weekend across a Tallinn midnight that is still Friday in UTC", () => {
  const s = { days: [1, 2, 3, 4, 5], hour: 0, minute: 15 };
  // Fri 13 Nov 2026 22:30Z = Sat 00:30 in Tallinn: Saturday's 00:15 is not a weekday slot
  assert.equal(lastSlot(s, z("2026-11-13T22:30:00Z"))!.toISOString(), "2026-11-12T22:15:00.000Z"); // Fri 00:15 Tallinn
  assert.equal(nextRun(s, z("2026-11-13T22:30:00Z"))!.toISOString(), "2026-11-15T22:15:00.000Z"); // Mon 00:15 Tallinn
});

test("the Tallinn day ends at local midnight in winter (UTC+2) and summer (UTC+3), not at UTC midnight", () => {
  assert.equal(new Date(tallinnDayEnd(Date.parse("2026-11-08T21:59:00Z"))).toISOString(), "2026-11-08T22:00:00.000Z");
  assert.equal(new Date(tallinnDayEnd(Date.parse("2026-11-08T22:00:00Z"))).toISOString(), "2026-11-09T22:00:00.000Z"); // already the 9th
  assert.equal(new Date(tallinnDayEnd(Date.parse("2026-07-01T20:59:00Z"))).toISOString(), "2026-07-01T21:00:00.000Z");
  assert.equal(new Date(tallinnDayEnd(Date.parse("2026-10-24T22:00:00Z"))).toISOString(), "2026-10-25T22:00:00.000Z"); // 25-hour day
  assert.equal(new Date(tallinnDayEnd(Date.parse("2027-03-27T23:00:00Z"))).toISOString(), "2027-03-28T21:00:00.000Z"); // 23-hour day
  assert.equal(new Date(tallinnDayEnd(Date.parse("2026-11-08T12:00:00Z"), 1)).toISOString(), "2026-11-09T22:00:00.000Z"); // +1 day
});

test("localDay follows the Tallinn calendar at both sides of UTC midnight", () => {
  assert.equal(localDay(z("2026-11-08T21:59:00Z")), "2026-11-08");
  assert.equal(localDay(z("2026-11-08T22:00:00Z")), "2026-11-09");
  assert.equal(localDay(z("2026-11-08T23:59:00Z")), "2026-11-09"); // UTC still says the 8th
});
