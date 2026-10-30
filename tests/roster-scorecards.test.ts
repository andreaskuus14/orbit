import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SAMPLE, routes, scorecards } from "../src/lib/roster-pure.ts";
import { units, type TaskRow } from "../src/lib/analytics-outcomes-pure.ts";

let n = 0;
const row = (agent: string, status: string, verified: boolean, mins = 10): TaskRow => {
  const i = n++, at = Date.parse("2026-10-01T10:00:00Z") + i * 3600_000;
  return { id: `t${i}`, parent_id: null, agent, title: `task ${i}`, status, created_at: new Date(at).toISOString(), started_at: new Date(at).toISOString(),
    finished_at: new Date(at + mins * 60_000).toISOString(), pending: verified ? [{ status: "approved", evidence: [{}] }] : [] };
};

test("AGT07 scorecards: per agent and class, with sample sizes; cost never attributed", () => {
  const cards = scorecards(units([row("atlas", "done", true, 4), row("atlas", "failed", false, 20), row("nova", "done", false)]));
  const a = cards.find((c) => c.agent === "atlas")!;
  assert.equal(a.cls, "single");
  assert.equal(a.n, 2);
  assert.deepEqual([a.success.n, a.success.of, a.verified.n], [1, 2, 1]);
  assert.equal(a.minutes, 4); // median of 4 and 20 (lower middle)
  assert.equal(a.costCovered, 0);
  assert.equal(a.enough, false);
});

test("AGT02 routing: default stays with tiny samples; switches only on a clear lead with enough data", () => {
  const few = routes(scorecards(units([row("atlas", "done", true), row("nova", "done", true)])));
  assert.equal(few[0].why, "agt.rt.few");
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => row("atlas", i < 3 ? "done" : "failed", i < 3)), // usual: 3/8 verified
    ...Array.from({ length: MIN_SAMPLE }, () => row("nova", "done", true)), // 5/5 verified
  ];
  const r = routes(scorecards(units(rows)))[0];
  assert.equal(r.usual, "atlas");
  assert.equal(r.agent, "nova");
  assert.equal(r.why, "agt.rt.better");
  const close = routes(scorecards(units([...Array.from({ length: 6 }, () => row("atlas", "done", true)), ...Array.from({ length: 5 }, () => row("nova", "done", true))])))[0];
  assert.equal(close.agent, "atlas");
  assert.equal(close.why, "agt.rt.usual");
});
