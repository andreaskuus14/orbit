import { test } from "node:test";
import assert from "node:assert/strict";
import { graceMinutes, localToUtc, nextOccurrences, lastWith } from "../src/lib/automation-preview-pure.ts";
import { automationDue } from "../src/lib/pure.ts";
import { blockedBy, outputClash, recoveryOptions, retryStepPatch } from "../src/lib/tasks-recovery-pure.ts";

const iso = (d: Date[]) => d.map((x) => x.toISOString());

test("next 3 occurrences in Tallinn time, daily/weekly/hourly", () => {
  const from = new Date("2026-01-10T12:00:00Z"); // 14:00 Tallinn (UTC+2)
  assert.deepEqual(iso(nextOccurrences({ every: "day", hour: 9, minute: 0 }, from)), ["2026-01-11T07:00:00.000Z", "2026-01-12T07:00:00.000Z", "2026-01-13T07:00:00.000Z"]);
  assert.deepEqual(iso(nextOccurrences({ every: "day", hour: 18, minute: 30 }, from, 1)), ["2026-01-10T16:30:00.000Z"]);
  assert.deepEqual(iso(nextOccurrences({ every: "week", weekday: 1, hour: 8, minute: 0 }, from, 2)), ["2026-01-12T06:00:00.000Z", "2026-01-19T06:00:00.000Z"]);
  assert.deepEqual(iso(nextOccurrences({ every: "hour", minute: 15 }, from)), ["2026-01-10T12:15:00.000Z", "2026-01-10T13:15:00.000Z", "2026-01-10T14:15:00.000Z"]);
});

test("DST: daily 09:00 keeps the wall clock across the change; a missing 03:30 runs at 04:30; a doubled 03:30 runs once", () => {
  const spring = iso(nextOccurrences({ every: "day", hour: 9, minute: 0 }, new Date("2026-03-28T12:00:00Z"))); // change 29 Mar 2026
  assert.deepEqual(spring, ["2026-03-29T06:00:00.000Z", "2026-03-30T06:00:00.000Z", "2026-03-31T06:00:00.000Z"]);
  assert.equal(new Date(localToUtc(2026, 2, 29, 3, 30)).toISOString(), "2026-03-29T01:30:00.000Z"); // = 04:30 EEST
  assert.equal(new Date(localToUtc(2026, 9, 25, 3, 30)).toISOString(), "2026-10-25T00:30:00.000Z"); // first 03:30 (EEST)
  const fall = nextOccurrences({ every: "day", hour: 3, minute: 30 }, new Date("2026-10-24T12:00:00Z"), 2);
  assert.deepEqual(iso(fall), ["2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
});

test("missed runs: one catch-up inside the grace window, skipped after it, never twice", () => {
  const s = { every: "day" as const, hour: 9, minute: 0 }, created = "2026-01-01T00:00:00Z";
  assert.equal(graceMinutes(s), 180); assert.equal(graceMinutes({ every: "hour" }), 30);
  const slot = new Date("2026-01-10T09:00:00"); // engine uses the server clock (the owner's PC, Tallinn)
  assert.equal(automationDue(s, null, created, new Date(slot.getTime() + 2 * 3600_000)), true);
  assert.equal(automationDue(s, null, created, new Date(slot.getTime() + 4 * 3600_000)), false);
  assert.equal(automationDue(s, new Date(slot.getTime() + 60_000).toISOString(), created, new Date(slot.getTime() + 2 * 3600_000)), false);
  assert.deepEqual(lastWith([{ status: "failed", id: 1 }, { status: "done", id: 2 }], "done"), { status: "done", id: 2 });
});

test("recovery options, step patch keeps receipts, prerequisites and the same-output guard", () => {
  const t = { status: "failed", parent_id: null, title: "x" };
  assert.deepEqual(recoveryOptions(t, [{ status: "approved" }, { status: "uncertain" }], false), ["retry_step", "resume", "abandon"]);
  assert.deepEqual(recoveryOptions(t, [], true), ["replace_input", "abandon"]);
  assert.deepEqual(recoveryOptions({ ...t, status: "cancelled" }, [{ status: "rejected" }], false), ["retry_step"]);
  assert.deepEqual(recoveryOptions({ ...t, status: "done" }, [{ status: "failed" }], true), []);
  assert.equal(retryStepPatch([{ status: "approved" }]), null);
  const p = retryStepPatch([{ status: "approved", evidence: [{ kind: "memory", id: "m" }] }, { status: "failed", attempt: "t:1", note: "x" }])!;
  assert.deepEqual(p.pending.map((a) => [a.status, a.attempt]), [["approved", undefined], ["pending", "t:1"]]);
  assert.equal(blockedBy({ status: "awaiting_approval" }, [{ status: "done" }, { status: "queued" }]).length, 1);
  assert.equal(blockedBy({ status: "failed" }, [{ status: "queued" }]).length, 0);
  const mine = [{ tool: "save_memory", input: { title: "Plan" }, status: "pending" }];
  assert.equal(outputClash(mine, [{ id: "o", status: "running", pending: [{ tool: "save_memory", input: { title: "plan " }, status: "attempting" }] }]), "o");
  assert.equal(outputClash(mine, [{ id: "o", status: "done", pending: [{ tool: "save_memory", input: { title: "plan" }, status: "approved" }] }]), null);
  assert.equal(outputClash(mine, [{ id: "o", status: "running", pending: [{ tool: "save_memory", input: { title: "other" }, status: "pending" }] }]), null);
});
