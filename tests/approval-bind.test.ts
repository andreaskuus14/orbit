import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingSeen, seenProblem } from "../src/lib/approval-bind-pure.ts";

const shown = [{ tool: "send_email", input: { to: "client@example.test", subject: "Preview", body: "Hi" }, status: "pending" }, { tool: "create_project", input: { name: "x" }, status: "approved" }];

test("same actions, any key order → same fingerprint; settled actions don't count", () => {
  const reordered = [{ tool: "send_email", input: { body: "Hi", subject: "Preview", to: "client@example.test" }, status: "pending" }];
  assert.equal(pendingSeen(shown), pendingSeen(reordered));
  assert.match(pendingSeen(shown), /^[0-9a-f]{16}$/);
});

test("changing any one field (recipient, text, tool, an added action) blocks the approval", () => {
  const seen = pendingSeen(shown);
  for (const changed of [
    [{ ...shown[0], input: { ...shown[0].input, to: "attacker@example.test" } }],
    [{ ...shown[0], input: { ...shown[0].input, body: "Hi!" } }],
    [{ ...shown[0], tool: "send_sms" }],
    [shown[0], { tool: "spend", input: { eur: 5 }, status: "pending" }],
  ]) assert.notEqual(seenProblem(changed, seen), "", JSON.stringify(changed));
  assert.equal(seenProblem(shown, seen), "");
  assert.notEqual(seenProblem(shown, 42), "", "a malformed fingerprint is refused, not ignored");
  assert.equal(seenProblem(shown, undefined), "", "callers that send none keep working");
});
