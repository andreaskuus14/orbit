import { test } from "node:test";
import assert from "node:assert/strict";
import { units, type TaskRow } from "../src/lib/analytics-outcomes-pure.ts";
import { cleanCalibration, cleanExperiment, experimentResult, improvementQueue, isoWeek, MIN_EXP, proposalFor, timeSaved } from "../src/lib/analytics-improve-pure.ts";

let n = 0;
const row = (o: Partial<TaskRow> & { at?: string } = {}): TaskRow => {
  const i = n++;
  return { id: `t${i}`, parent_id: null, agent: "atlas", title: o.title ?? `task ${i}`, status: o.status ?? "done", error: o.error ?? null,
    pending: o.pending ?? [{ status: "approved", evidence: [{}] }], created_at: o.at ?? "2026-10-20T10:00:00Z", finished_at: o.finished_at ?? null };
};

test("ANA02 time saved: unknown until calibrated; minus supervision incl. failed work", () => {
  const us = units([row(), row(), row({ status: "failed", pending: [] }), row({ title: "retry me", status: "failed", pending: [] }), row({ title: "retry me", at: "2026-10-20T11:00:00Z" })]);
  assert.equal(timeSaved(us, cleanCalibration({})), null);
  const r = timeSaved(us, cleanCalibration({ manual: { single: 30 }, touch: 2 }))!;
  const s = r.rows.find((x) => x.type === "single")!;
  assert.equal(s.accepted, 3);
  assert.equal(s.gross, 90);
  // touches: 3 approvals (one per accepted unit) + 1 retry = 4 → 8 min supervision
  assert.equal(s.touches, 4);
  assert.equal(r.minutes, 82);
  assert.equal(r.label, "estimate");
  assert.deepEqual(cleanCalibration({ manual: { single: -1, goal: 99999, chain: 12.4 }, touch: "x" }), { manual: { chain: 12 }, touch: null });
});

test("ANA07 experiment: before/after windows of equal length; too few is not a result", () => {
  const e = cleanExperiment({ name: "Shorter prompts", change: "trim the system prompt", metric: "success" }, "e1", "2026-10-20T00:00:00Z");
  assert.ok(typeof e !== "string");
  assert.equal(typeof cleanExperiment({ name: "x", change: "y", metric: "nope" }, "e", "now"), "string");
  const mk = (day: number, status: string) => row({ at: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`, status });
  const before = Array.from({ length: MIN_EXP }, (_, i) => mk(15 + (i % 5), i < 5 ? "done" : "failed"));
  const after = Array.from({ length: MIN_EXP }, (_, i) => mk(21 + (i % 5), i < 8 ? "done" : "failed"));
  const r = experimentResult(e, units([...before, ...after]), Date.parse("2026-10-26T00:00:00Z"));
  assert.deepEqual([r.before.pct, r.after.pct, r.diff, r.enough, r.days], [50, 80, 30, true, 6]);
  const few = experimentResult(e, units(after.slice(0, 3)), Date.parse("2026-10-26T00:00:00Z"));
  assert.equal(few.enough, false);
  assert.equal(few.diff, null);
});

test("ANA08 queue: recurring failures and high rates become scoped proposals, at most 3, keyed per week", () => {
  const rows = [
    ...Array.from({ length: 4 }, () => row({ status: "failed", error: "request timed out after 120s", pending: [] })),
    ...Array.from({ length: 4 }, () => row()),
  ];
  const q = improvementQueue(units(rows), "2026-W44");
  assert.ok(q.length >= 1 && q.length <= 3);
  assert.ok(q.some((x) => x.key === "2026-W44:single:timeout"));
  const p = proposalFor(q[0]);
  assert.equal(p.kind, "improvement");
  assert.match(p.prompt, /propose, don't apply/);
  assert.equal(improvementQueue(units([row()]), "2026-W44").length, 0);
  assert.equal(isoWeek(new Date("2026-10-30T12:00:00Z")), "2026-W44");
  assert.equal(isoWeek(new Date("2027-01-01T12:00:00Z")), "2026-W53");
});
