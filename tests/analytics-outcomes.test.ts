import { test } from "node:test";
import assert from "node:assert/strict";
import { METRICS, outcomeRates, pct, reliability, timeAndCost, units, worstFailure, type TaskRow } from "../src/lib/analytics-outcomes-pure.ts";

let n = 0;
const t = (o: Partial<TaskRow>): TaskRow => ({ id: `t${n++}`, parent_id: null, agent: "nova", title: "job", status: "done", pending: null,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), ...o });
const ok = [{ status: "approved", evidence: [{ kind: "file" }] }];

test("every metric names formula, source, Tallinn timezone, cadence and exclusions", () => {
  for (const m of Object.values(METRICS)) { assert.equal(m.tz, "Europe/Tallinn"); assert.ok(m.formula && m.source && m.cadence && m.exclusions); }
});

test("ten retries of one task count once, ending in the last attempt", () => {
  const rows = [...Array.from({ length: 9 }, () => t({ status: "failed", error: "Timed out" })), t({ status: "done", pending: ok })];
  const us = units(rows);
  assert.equal(us.length, 1);
  const o = outcomeRates(us);
  assert.deepEqual([o.accepted.n, o.accepted.of, o.autonomous.n, o.intervention.n], [1, 1, 0, 1]);
  const r = reliability(us).find((x) => x.type === "single")!;
  assert.deepEqual([r.sample, r.recovery.n, r.recovery.of, r.timeout.n], [1, 1, 1, 1]);
});

test("no data stays unknown, not zero; open work is excluded", () => {
  const o = outcomeRates(units([t({ title: "a", status: "running" })]));
  assert.equal(pct(o.accepted), null);
  assert.equal(o.open, 1);
  assert.equal(pct(reliability([])[0].success), null);
  const c = timeAndCost([], null);
  assert.equal(c.metered, null);
  assert.ok(c.gaps.includes("ana.gapUsage"));
});

test("cancelled counts as finished and intervention; done without read-back is not verified; rework", () => {
  const us = units([t({ title: "c", status: "cancelled" }), t({ title: "u", status: "done", pending: [{ status: "approved" }] }),
    t({ title: "r", status: "done" }), t({ title: "r", status: "done" })]);
  const o = outcomeRates(us);
  assert.equal(o.accepted.of, 3);
  assert.equal(o.autonomous.n, 0);
  assert.equal(o.intervention.n, 2); // cancelled + retried
  assert.deepEqual([o.rework.n, o.rework.of], [1, 2]);
  assert.equal(reliability(us)[0].verifyFail.n, 1);
});

test("worst recurring failure needs two units and links its tasks", () => {
  const a = t({ title: "x", status: "failed", error: "Input 12 is stale" }), b = t({ title: "y", status: "failed", error: "Input 99 is stale" });
  const w = worstFailure(units([a, b, t({ title: "z", status: "failed", error: "other" })]))!;
  assert.deepEqual(w.ids.sort(), [a.id, b.id].sort());
  assert.equal(worstFailure(units([a])), null);
});

test("cost splits metered from subscription and never invents project cost", () => {
  const c = timeAndCost(units([t({ project_id: "p", started_at: "2026-10-01T00:00:00Z", finished_at: "2026-10-01T00:30:00Z" })]),
    [{ model: "m", purpose: "x", input_tokens: 1, output_tokens: 1, cost_usd: "0.5" }, { model: "m", purpose: "x", input_tokens: 3, output_tokens: 0, cost_usd: 0 }]);
  assert.deepEqual([c.metered!.usd, c.subscription!.tokens, c.projects[0].minutes, c.projects[0].cost], [0.5, 3, 30, null]);
});
