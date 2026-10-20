import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblem } from "../src/lib/password-pure.ts";

test("password rules: length, not blank, both fields match", () => {
  assert.match(passwordProblem("short", "short"), /at least 10/);
  assert.match(passwordProblem("x".repeat(73), "x".repeat(73)), /at most 72/);
  assert.match(passwordProblem(" ".repeat(12), " ".repeat(12)), /only spaces/);
  assert.match(passwordProblem("long enough pw", "long enough px"), /don't match/);
  assert.equal(passwordProblem("long enough pw", "long enough pw"), "");
});
