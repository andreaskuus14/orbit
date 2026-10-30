import { test } from "node:test";
import assert from "node:assert/strict";
import { weekCalendar } from "../src/lib/clips/calendar-pure.ts";
import { DEFAULT_PUBLISH } from "../src/lib/clips/schedule.ts";

const T = (iso: string) => Date.parse(iso);
const S = DEFAULT_PUBLISH; // Europe/Tallinn 12:00, 17:00, 21:00, 3 per day
const job = (clips: object[]) => [{ id: "j1", clips: clips as { id: string; title: string }[] }];

test("7 local days from today in the publish zone, across the fall-back DST change", () => {
  // 2026-10-24 23:30 Tallinn (+3) = 20:30Z; the 25th is the fall-back day
  const w = weekCalendar([], S, T("2026-10-24T20:30:00Z"));
  assert.deepEqual(w.map((d) => d.key), ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(w[0].free.length, 0, "today's slots are all past");
  assert.deepEqual(w[1].free.map((t) => new Date(t).toISOString()), ["2026-10-25T10:00:00.000Z", "2026-10-25T15:00:00.000Z", "2026-10-25T19:00:00.000Z"], "clocks fall back at 04:00, so the whole day is +2");
  assert.equal(new Date(weekCalendar([], S, T("2026-10-24T05:00:00Z"))[0].free[0]).toISOString(), "2026-10-24T09:00:00.000Z", "before fall-back 12:00 is +3");
});

test("day bucketing uses the publish zone, not UTC", () => {
  // 22:30Z on the 16th is 01:30 on the 17th in Tallinn
  const w = weekCalendar(job([{ id: "a", title: "A", publish: { status: "scheduled", scheduledFor: "2026-10-16T22:30:00Z", at: "x" } }]), S, T("2026-10-16T06:00:00Z"));
  assert.equal(w[0].items.length, 0);
  assert.equal(w[1].items[0].title, "A");
  const ny = weekCalendar(job([{ id: "a", title: "A", publish: { status: "scheduled", scheduledFor: "2026-10-16T22:30:00Z", at: "x" } }]), { ...S, timezone: "America/New_York" }, T("2026-10-16T06:00:00Z"));
  assert.equal(ny[0].items[0].title, "A", "18:30 in New York is still the 16th");
});

test("statuses, sorting and occupied slots", () => {
  const now = T("2026-10-16T06:00:00Z"); // 09:00 Tallinn
  const w = weekCalendar(job([
    { id: "s", title: "Later", thumb: "t.jpg", publish: { status: "scheduled", scheduledFor: "2026-10-16T14:00:00Z" } }, // 17:00
    { id: "p", title: "Live", publish: { status: "scheduled", scheduledFor: "2026-10-16T05:00:00Z" } }, // 08:00, past but unconfirmed → due
    { id: "d", title: "Done", publish: { status: "done", startedAt: "2026-10-16T04:00:00Z", at: "2026-10-16T04:10:00Z" } },
    { id: "f", title: "Bad", publish: { status: "failed", at: "2026-10-17T08:00:00Z", error: "quota" } },
    { id: "u", title: "Up", publish: { status: "uploading", at: "2026-10-16T05:00:00Z" } }, // no publish time → not shown
    { id: "n", title: "Draft" },
  ]), S, now);
  assert.deepEqual(w[0].items.map((i) => [i.title, i.status]), [["Done", "published"], ["Live", "due"], ["Later", "scheduled"]]);
  assert.equal(w[0].items[2].thumb, "t.jpg");
  assert.deepEqual(w[1].items.map((i) => [i.status, i.error]), [["failed", "quota"]]);
  // 3 used today (perDay 3) → no free slot today; 17:00 is taken anyway
  assert.equal(w[0].free.length, 0);
  assert.equal(w[1].free.length, 3);
  assert.equal(w.reduce((n, d) => n + d.free.length, 0), 18);
});

test("a taken slot is not offered as free", () => {
  const now = T("2026-10-16T06:00:00Z");
  const w = weekCalendar(job([{ id: "s", title: "S", publish: { status: "scheduled", scheduledFor: "2026-10-17T14:10:00Z" } }]), S, now);
  assert.deepEqual(w[1].free.map((t) => new Date(t).toISOString()), ["2026-10-17T09:00:00.000Z", "2026-10-17T18:00:00.000Z"]);
});
