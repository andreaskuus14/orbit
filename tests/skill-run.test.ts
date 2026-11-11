import test from "node:test";
import assert from "node:assert/strict";
import { skillRunLabel, turnRunState } from "../src/lib/skill-run-pure.ts";

const rc = (status: string) => [{ receipt: { status } }];

test("an inline turn's label follows the verified receipt, not the end of the stream", () => {
  assert.equal(turnRunState(rc("verified")), "completed");
  assert.equal(turnRunState(rc("partly")), "partial");
  assert.equal(turnRunState(rc("failed")), "failed");
  assert.equal(turnRunState(rc("unverified")), "reply");
  assert.equal(turnRunState([{ receipt: { status: "bogus" } }]), "reply");
  for (const none of [undefined, null, [], [{}]]) assert.equal(turnRunState(none), "reply"); // nothing changed: never "Completed"
});

test("a turn stopped by policy says Waiting for you, even if an earlier step wrote something", () => {
  assert.equal(turnRunState([...rc("verified"), { policy: { verdict: "refuse" } }]), "waiting");
  assert.equal(skillRunLabel({ state: "waiting" }), "Waiting for you");
});

test("the task row decides how a background run ended; failed and cancelled never read Completed", () => {
  assert.equal(skillRunLabel({ state: "finished" }, "failed"), "Failed");
  assert.equal(skillRunLabel({ state: "finished" }, "cancelled"), "Cancelled");
  assert.equal(skillRunLabel({ state: "finished" }, "done"), "Completed");
  assert.equal(skillRunLabel({ state: "started" }, "awaiting_approval"), "Needs approval");
  assert.equal(skillRunLabel({ state: "finished" }), "Finished"); // bg_done with no row yet: not claimed as success
  assert.equal(skillRunLabel({ state: "finished" }, "running"), "Finished");
});

test("receipt-only labels", () => {
  assert.equal(skillRunLabel(undefined), "");
  assert.deepEqual((["queued", "handled", "started", "cancelled", "failed"] as const).map((state) => skillRunLabel({ state })),
    ["Queued", "Handled by a command", "Started", "Cancelled", "Failed"]);
});
