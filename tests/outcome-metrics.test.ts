import { test } from "node:test";
import assert from "node:assert/strict";
import { pctOf, weeklyOutcomes, type OutcomeTask } from "../src/lib/outcome-metrics-pure.ts";

const NOW = Date.UTC(2026, 9, 28, 12); // Wed, 2026-W44
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
let n = 0;
const task = (o: Partial<OutcomeTask> & { h: number; doneAfterMin?: number }): OutcomeTask => ({
  id: `t${n++}`, parent_id: null, agent: "nova", title: `job ${n}`, status: "done", pending: null,
  created_at: at(o.h), finished_at: o.doneAfterMin == null ? null : new Date(NOW - o.h * 3_600_000 + o.doneAfterMin * 60_000).toISOString(), ...o,
});

test("weeklyOutcomes: denominators, simple vs multi-step, last week apart", () => {
  const chain = task({ h: 5, title: "Team: trailer", doneAfterMin: 30 });
  const rows = [
    task({ h: 30, title: "Brief", doneAfterMin: 4 }), task({ h: 20, title: "Brief", doneAfterMin: 2 }), // redo within 24 h → first one corrected
    task({ h: 10, title: "Scan", status: "failed", doneAfterMin: 1 }),
    task({ h: 9, title: "Mail", doneAfterMin: 10, pending: [{ tool: "send", status: "rejected" }] }),
    task({ h: 8, title: "Same", status: "cancelled" }), task({ h: 7.9, title: "Same", status: "cancelled" }), // duplicate start within 10 min
    chain, task({ h: 5, parent_id: chain.id, title: "step 1" }), // child: not a unit
    task({ h: 24 * 7 + 2, title: "Old", doneAfterMin: 60, pending: [{ tool: "save", status: "approved" }] }), // last week
  ];
  const { now, prev } = weeklyOutcomes(rows, NOW);
  assert.equal(now.week, "2026-W44");
  assert.equal(now.simple.units, 6);
  assert.deepEqual(now.simple.correctionFree, { n: 2, of: 6 }); // 3 done, one redone; finished = 6
  assert.equal(now.simple.medianMin, 4); // 2, 4, 10
  assert.deepEqual(now.simple.abandoned, { n: 3, of: 6 });
  assert.deepEqual(now.simple.duplicates, { n: 1, of: 6 });
  assert.deepEqual(now.simple.kept, { n: 0, of: 1 });
  assert.equal(now.multi.units, 1);
  assert.deepEqual(now.multi.correctionFree, { n: 1, of: 1 });
  assert.equal(prev.simple.units, 1);
  assert.deepEqual(prev.simple.kept, { n: 1, of: 1 });
  assert.equal(pctOf(prev.multi.kept), null);
});

test("an open task counts as abandoned only after 7 days", () => {
  const rows = [task({ h: 1, status: "running" }), task({ h: 24 * 8, status: "awaiting_approval" })];
  assert.deepEqual(weeklyOutcomes(rows, NOW).now.simple.abandoned, { n: 0, of: 1 });
  assert.deepEqual(weeklyOutcomes(rows, NOW + 7 * 86_400_000).prev.simple.abandoned, { n: 1, of: 1 });
});
