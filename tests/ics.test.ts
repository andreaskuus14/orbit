import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { icsEvents, looksLikeIcs } from "../src/lib/ics-pure.ts";

const ics = readFileSync(new URL("./fixtures/timetable.ics", import.meta.url), "utf8");
// Expected list comes from Python icalendar + recurring-ical-events (minus STATUS:CANCELLED, which we drop on purpose).
const expected = JSON.parse(readFileSync(new URL("./fixtures/timetable.expected.json", import.meta.url), "utf8")) as [string, string, string, boolean][];

test("weekly RRULE, UNTIL, EXDATE, TZID across the Tallinn DST change, moved lesson, all-day: same as icalendar", () => {
  const got = icsEvents(ics, Date.UTC(2026, 9, 1), Date.UTC(2026, 11, 31)).map((e) => [e.title, e.start, e.end, e.allDay]);
  assert.deepEqual(got, expected);
});

test("wall clock holds over DST: 08:15 is 05:15Z before 25 Oct and 06:15Z after", () => {
  const m = icsEvents(ics, Date.UTC(2026, 9, 19), Date.UTC(2026, 9, 28)).filter((e) => e.title.startsWith("Mathematics"));
  assert.deepEqual(m.map((e) => e.start), ["2026-10-19T05:15:00.000Z", "2026-10-21T05:15:00.000Z", "2026-10-26T06:15:00.000Z"]); // 28 Oct is EXDATEd
});

test("text is plain data: no description, no markup, cancelled dropped", () => {
  const ev = icsEvents(ics, Date.UTC(2026, 9, 1), Date.UTC(2026, 11, 31));
  assert.ok(!JSON.stringify(ev).includes("IGNORE"));
  assert.ok(!ev.some((e) => e.title === "Cancelled"));
  assert.equal(ev[0].location, "Room 204");
  assert.ok(icsEvents("BEGIN:VEVENT\nSUMMARY:<b>x</b>\nDTSTART:20261020T070000Z\nEND:VEVENT", 0, 1e15)[0].title === "b x /b");
});

test("window, junk and size guards", () => {
  assert.deepEqual(icsEvents(ics, Date.UTC(1999, 0, 1), Date.UTC(1999, 1, 1)), []);
  assert.deepEqual(icsEvents("not a calendar", 0, 1e15), []);
  assert.deepEqual(icsEvents("BEGIN:VEVENT\nDTSTART:garbage\nEND:VEVENT", 0, 1e15), []);
  assert.equal(looksLikeIcs(ics), true); assert.equal(looksLikeIcs("hello"), false);
  const endless = "BEGIN:VEVENT\nUID:a\nDTSTART:20000101T100000Z\nDTEND:20000101T110000Z\nRRULE:FREQ=DAILY\nSUMMARY:d\nEND:VEVENT";
  assert.equal(icsEvents(endless, Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 3)).length, 2); // 26 years of daily steps still answer fast
});
