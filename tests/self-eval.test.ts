import { test } from "node:test";
import assert from "node:assert/strict";
import { addRecord, evalTrend, staticEval, toRecord, type EvalRecord } from "../src/lib/self-eval-pure.ts";

const rec = (week: string, cats: EvalRecord["cats"], failed: string[] = [], redTeamFailures = 0): EvalRecord => ({ date: "2026-10-01", week, cats, failed, redTeamFailures });

test("toRecord tallies per category and counts red-team failures apart from retrieval", () => {
  const r = toRecord([{ id: "a", category: "send", passed: true, why: "" }, { id: "b", category: "send", passed: false, why: "ALLOWED" },
    { id: "c", category: "retrieval", passed: false, why: "worse" }], Date.UTC(2026, 9, 28), "2026-W44");
  assert.deepEqual(r, { date: "2026-10-28", week: "2026-W44", cats: { send: { pass: 1, total: 2 }, retrieval: { pass: 0, total: 1 } }, failed: ["b", "c"], redTeamFailures: 1 });
});

test("addRecord replaces the same week and keeps 12", () => {
  let runs: EvalRecord[] = [];
  for (let i = 1; i <= 14; i++) runs = addRecord(runs, rec(`W${i}`, {}));
  assert.equal(runs.length, 12);
  assert.equal(runs[0].week, "W3");
  runs = addRecord(runs, rec("W14", { send: { pass: 1, total: 1 } }));
  assert.equal(runs.length, 12);
  assert.deepEqual(runs.at(-1)!.cats, { send: { pass: 1, total: 1 } });
});

test("evalTrend: this week vs the mean of the last 4, regressions named", () => {
  assert.equal(evalTrend([]), null);
  const runs = [rec("W1", { send: { pass: 0, total: 2 } }), rec("W2", { send: { pass: 2, total: 2 } }), rec("W3", { send: { pass: 1, total: 2 } }),
    rec("W4", { send: { pass: 2, total: 2 } }), rec("W5", { send: { pass: 2, total: 2 }, retrieval: { pass: 3, total: 4 } }, ["old"]),
    rec("W6", { send: { pass: 1, total: 2 }, retrieval: { pass: 4, total: 4 } }, ["old", "new"], 1)];
  const t = evalTrend(runs)!;
  assert.deepEqual(t.rows, [{ cat: "retrieval", pct: 100, prev: 75 }, { cat: "send", pct: 50, prev: 88 }]); // W2..W5: 100,50,100,100
  assert.deepEqual(t.regressions, ["new"]);
  assert.equal(t.redTeamFailures, 1);
  assert.deepEqual(evalTrend([runs[0]])!.rows, [{ cat: "send", pct: 0, prev: null }]);
});

test("staticEval: the live suite scores clean (0 red-team failures, retrieval no worse than baseline)", async () => {
  const r = await staticEval(Date.UTC(2026, 9, 28), "2026-W44");
  assert.equal(r.redTeamFailures, 0);
  assert.deepEqual(r.failed, []);
  assert.ok(r.cats.retrieval.total > 0 && r.cats.send.total > 0);
});
