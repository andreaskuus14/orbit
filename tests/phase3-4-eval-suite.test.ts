import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSkillHealth, runOrbitCapabilitySuite } from "../src/lib/eval-suite-pure.ts";

test("runOrbitCapabilitySuite executes all 8 real deterministic ORBIT capability checks cleanly", () => {
  const report = runOrbitCapabilitySuite();
  assert.equal(report.total, 8);
  assert.equal(report.failed, 0, `Failed checks: ${JSON.stringify(report.checks.filter((c) => !c.pass))}`);
  assert.equal(report.passed, 8);
});

test("evaluateSkillHealth classifies promote, healthy, and retire thresholds accurately", () => {
  assert.equal(evaluateSkillHealth({ name: "s1", runs: 4, passes: 4, fails: 0 }).action, "promote");
  assert.equal(evaluateSkillHealth({ name: "s2", runs: 5, passes: 1, fails: 4 }).action, "retire");
  assert.equal(evaluateSkillHealth({ name: "s3", runs: 2, passes: 2, fails: 0 }).action, "healthy");
});
