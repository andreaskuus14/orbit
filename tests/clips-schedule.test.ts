import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PUBLISH, nextSlots, parseSettings, usedSlots, zonedTime } from "../src/lib/clips/schedule.ts";
import { videoResource } from "../src/lib/yt-analytics-pure.ts";

const T = (iso: string) => Date.parse(iso);
const S = DEFAULT_PUBLISH; // Europe/Tallinn 12:00, 17:00, 21:00, 3 per day

test("zonedTime follows DST in the owner's zone", () => {
  assert.equal(new Date(zonedTime(2026, 1, 15, "12:00", "Europe/Tallinn")).toISOString(), "2026-01-15T10:00:00.000Z"); // EET +2
  assert.equal(new Date(zonedTime(2026, 7, 15, "12:00", "Europe/Tallinn")).toISOString(), "2026-07-15T09:00:00.000Z"); // EEST +3
  assert.equal(new Date(zonedTime(2026, 3, 29, "12:00", "Europe/Tallinn")).toISOString(), "2026-03-29T09:00:00.000Z"); // spring-forward day
  assert.equal(new Date(zonedTime(2026, 10, 25, "21:00", "Europe/Tallinn")).toISOString(), "2026-10-25T19:00:00.000Z"); // fall-back day
  assert.equal(new Date(zonedTime(2026, 3, 8, "12:00", "America/New_York")).toISOString(), "2026-03-08T16:00:00.000Z");
  assert.equal(new Date(zonedTime(2026, 3, 29, "03:30", "Europe/Tallinn")).toISOString(), "2026-03-29T01:30:00.000Z", "skipped time lands after the jump (04:30)");
});

test("nextSlots: next free slots, 15-minute lead, spread across days", () => {
  // 2026-10-16 11:50 Tallinn (+3): 12:00 is only 10 min away → skipped
  assert.deepEqual(nextSlots(S, [], T("2026-10-16T08:50:00Z"), 4),
    ["2026-10-16T14:00:00.000Z", "2026-10-16T18:00:00.000Z", "2026-10-17T09:00:00.000Z", "2026-10-17T14:00:00.000Z"]);
  assert.deepEqual(nextSlots(S, [], T("2026-10-16T08:44:00Z")), ["2026-10-16T09:00:00.000Z"], "16 min ahead is fine");
  assert.deepEqual(nextSlots(S, [], T("2026-10-16T08:45:00Z")), ["2026-10-16T14:00:00.000Z"], "exactly 15 min is too tight (clock drift before videoResource)");
  // Across the 25 Oct fall-back: 21:00 local is 18:00Z before, 19:00Z after
  assert.deepEqual(nextSlots(S, [], T("2026-10-24T19:00:00Z"), 4),
    ["2026-10-25T10:00:00.000Z", "2026-10-25T15:00:00.000Z", "2026-10-25T19:00:00.000Z", "2026-10-26T10:00:00.000Z"]);
});

test("nextSlots skips used slots (near ones too) and honours perDay", () => {
  const now = T("2026-10-16T06:00:00Z");
  const used = [T("2026-10-16T09:00:00Z"), T("2026-10-16T14:10:00Z")]; // 12:00 exactly, ~17:10
  assert.deepEqual(nextSlots(S, used, now, 2), ["2026-10-16T18:00:00.000Z", "2026-10-17T09:00:00.000Z"]);
  const two = { ...S, perDay: 2 };
  assert.deepEqual(nextSlots(two, used, now, 2), ["2026-10-17T09:00:00.000Z", "2026-10-17T14:00:00.000Z"], "today already has 2");
  // a clip that already went out today (past) still counts toward perDay, but doesn't block nearby slots
  assert.deepEqual(nextSlots(two, [T("2026-10-16T05:00:00Z"), T("2026-10-16T09:00:00Z")], now, 1), ["2026-10-17T09:00:00.000Z"]);
  assert.deepEqual(nextSlots(S, [T("2026-10-16T08:35:00Z")], T("2026-10-16T08:40:00Z"), 1), ["2026-10-16T09:00:00.000Z"], "25 min after a past upload is fine");
  const slots = nextSlots(S, [], now, 9);
  assert.equal(new Set(slots).size, 9, "never the same slot twice");
});

test("usedSlots: scheduled, maybe-scheduled and published-now clips from the last 24 h on", () => {
  const now = T("2026-10-16T00:00:00Z");
  const c = (status: string, scheduledFor?: string, startedAt?: string) => ({ publish: { status, at: "x", ...(scheduledFor ? { scheduledFor } : {}), ...(startedAt ? { startedAt } : {}) } });
  const jobs = [{ clips: [c("scheduled", "2026-10-17T09:00:00Z"), c("scheduled", "2026-10-15T09:00:00Z"), c("scheduled", "2026-10-14T09:00:00Z"), c("done", undefined, "2026-10-15T20:00:00Z"), { }] },
    { clips: [c("unknown", "2026-10-18T09:00:00Z"), c("failed", "2026-10-19T09:00:00Z"), c("uploading", "2026-10-20T09:00:00Z"), c("done")] }];
  assert.deepEqual(usedSlots(jobs, now), [T("2026-10-17T09:00:00Z"), T("2026-10-15T09:00:00Z"), T("2026-10-15T20:00:00Z"), T("2026-10-18T09:00:00Z"), T("2026-10-20T09:00:00Z")]);
});

test("parseSettings validates and normalises", () => {
  assert.deepEqual(parseSettings({ timezone: "Europe/Tallinn", slots: ["21:00", "12:00", "12:00"], perDay: 2 }), { timezone: "Europe/Tallinn", slots: ["12:00", "21:00"], perDay: 2 });
  for (const b of [null, [], { ...S, timezone: "Mars/Base" }, { ...S, slots: [] }, { ...S, slots: ["24:00"] }, { ...S, slots: ["9:00"] }, { ...S, perDay: 4 }, { ...S, perDay: 0 }, { ...S, perDay: 1.5 }])
    assert.equal(typeof parseSettings(b), "string", JSON.stringify(b));
});

test("videoResource requires publishAt at least 15 minutes ahead", () => {
  const now = T("2026-10-16T12:00:00Z"), clip = { title: "t", hook: "h" };
  assert.equal(typeof videoResource({ publishAt: "2026-10-16T12:14:00Z" }, clip, now), "string");
  assert.equal(typeof videoResource({ publishAt: "2026-10-16T12:15:00Z" }, clip, now), "object");
});
