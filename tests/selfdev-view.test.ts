import { test } from "node:test";
import assert from "node:assert/strict";
import { parseControl, releaseStage, taskStage } from "../src/lib/selfdev-pure.ts";

test("stages never upgrade a claim: builder checks are 'tested', only a kept release is 'verified after deployment'", () => {
  assert.equal(taskStage("edited"), "implemented");
  assert.equal(taskStage("verified"), "tested");
  assert.equal(taskStage("submitted"), "tested");
  assert.equal(taskStage("done", "released and verified after deployment"), "verified");
  assert.equal(taskStage("done", "no change: not reproducible"), "noChange");
  assert.equal(taskStage("done", "failed: checks failed"), "failed");
  assert.equal(releaseStage("merged"), "ci");
  assert.equal(releaseStage("installed"), "deployed");
  assert.equal(releaseStage("retained"), "verified");
  assert.equal(releaseStage("rolledBack"), "rolledBack");
  assert.equal(releaseStage("failed"), "failed");
});

test("the app can only ask for safer states", () => {
  assert.deepEqual(parseControl({ action: "stop" }), { action: "stop" });
  assert.deepEqual(parseControl({ action: "pause", releaseId: "x" }), { action: "pause" });
  // restore moves the live app and main, approve releases: both are the owner's (ctl/), never the app's or the builder's inbox
  for (const bad of [{ action: "resume" }, { action: "clear" }, { action: "release" }, { action: "restore" }, { action: "restore", releaseId: "r-1" },
    { action: "approve", releaseId: "r-1", commit: "a".repeat(40) }, null, "stop"])
    assert.equal(parseControl(bad), null, JSON.stringify(bad));
});
