import { test } from "node:test";
import assert from "node:assert/strict";
import { briefProblems, communicationText, isBrief, withBrief } from "../src/lib/brief-mode-pure.ts";

test("the marker switches on and off and keeps the owner's own words", () => {
  assert.equal(isBrief(""), false);
  const on = withBrief("Use metric units.", true);
  assert.equal(on, "[brief] Use metric units.");
  assert.ok(isBrief(on));
  assert.equal(withBrief(on, true), on, "idempotent");
  assert.equal(withBrief(on, false), "Use metric units.");
  assert.equal(communicationText(on), "Use metric units.");
  assert.equal(withBrief("", true), "[brief]");
});

test("the checker flags filler openers and unnumbered multi-step answers", () => {
  assert.deepEqual(briefProblems("Run npm test, then open the PR."), []);
  assert.deepEqual(briefProblems("1. Open Profile\n2. Turn on Brief\n3. Save"), []);
  assert.deepEqual(briefProblems("Great question! You can do it."), ["starts with filler"]);
  assert.deepEqual(briefProblems("- open it\n- click save\n- reload"), ["3+ steps not numbered"]);
  assert.deepEqual(briefProblems("First open it, then save, next reload, finally check."), ["3+ steps not numbered"]);
});
