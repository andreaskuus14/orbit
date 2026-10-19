import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreAgentRuns } from "../src/lib/agent-scorecard-pure.ts";
import { AGENT_CASES } from "../evals/agent-cases.ts";
import { RETRIEVAL_CASES } from "../evals/memory-cases.ts";
import { rerankMemories } from "../src/lib/memory-retrieval-pure.ts";

const cases = [{ id: "a" }, { id: "b" }];
const run = { caseId: "a", ratings: { correctness: 2, evidence: 2, completion: 2, toolUse: 2, approval: 2 }, latencyMs: 150, notes: "Checked the saved result and trace." };

test("unrun agent cases are pending, never scored as passes", () => {
  const empty = scoreAgentRuns(cases, []);
  assert.equal(empty.recorded, 0);
  assert.equal(empty.passed, 0);
  assert.equal(empty.averagePoints, null);
  assert.equal(empty.averageLatencyMs, null);
  assert.deepEqual(empty.pending, ["a", "b"]);
  const one = scoreAgentRuns(cases, [run]);
  assert.equal(one.averagePoints, 10);
  assert.equal(one.passed, 1);
  assert.deepEqual(one.pending, ["b"]);
});

test("correctness, evidence and approval failures can't be hidden by a high average", () => {
  for (const d of ["correctness", "evidence", "approval"]) {
    const result = scoreAgentRuns(cases, [{ ...run, ratings: { ...run.ratings, [d]: 0 } }]);
    assert.equal(result.runs[0].points, 8);
    assert.equal(result.runs[0].passed, false, d);
  }
});

test("rejects duplicate/unknown cases, fabricated rating ranges and missing evidence", () => {
  for (const data of [null, [run, run], [{ ...run, caseId: "unknown" }], [{ ...run, ratings: {} }], [{ ...run, ratings: { ...run.ratings, evidence: 3 } }], [{ ...run, latencyMs: -1 }], [{ ...run, notes: "" }]]) {
    assert.throws(() => scoreAgentRuns(cases, data));
  }
});

test("scorecard suites have 24 unique cases and retrieval improves without fixture regressions", () => {
  for (const suite of [AGENT_CASES, RETRIEVAL_CASES]) {
    assert.equal(suite.length, 24);
    assert.equal(new Set(suite.map((c) => c.id)).size, 24);
  }
  let improved = 0;
  const rr = (ids: string[], relevant: string[]) => {
    if (!relevant.length) return ids.length === 0 ? 1 : 0;
    const i = ids.findIndex((id) => relevant.includes(id));
    return i < 0 ? 0 : 1 / (i + 1);
  };
  for (const c of RETRIEVAL_CASES) {
    const before = rr([...new Set(c.primary.map((m) => m.id))].slice(0, 8), c.relevant);
    const out = rerankMemories([...c.primary, ...(c.context ?? [])], c.query, c.primary.map((m) => m.id), 8, c.project, Date.parse("2026-10-19T12:00:00Z"));
    const after = rr(out.map((m) => m.id), c.relevant);
    assert.ok(after >= before, `${c.id}: ${after} < ${before}`);
    if (after > before) improved++;
  }
  assert.ok(improved > 0);
});

test("CLI reports pending coverage and fails closed for incomplete runs or invalid arguments", () => {
  const script = fileURLToPath(new URL("../scripts/ai-scorecard.ts", import.meta.url));
  const invoke = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8", timeout: 10000 });
  const normal = invoke("--json");
  assert.equal(normal.status, 0, normal.stderr);
  const report = JSON.parse(normal.stdout);
  assert.equal(report.agent.recorded, 0);
  assert.equal(report.agent.pending.length, 24);
  assert.equal(invoke("--require-complete").status, 1);
  for (const args of [["--typo"], ["--results"], ["--results", "--json"], ["--results", "missing.json"]]) assert.equal(invoke(...args).status, 1);
});
