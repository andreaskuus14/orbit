import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRED_ERROR, dueExpiries, expiredError, expiryMs, isExpiredError } from "../src/lib/approval-expiry-pure.ts";

const H = 3600_000, now = Date.parse("2026-11-02T10:00:00Z");
const row = (id: string, hoursAgo: number, pending: unknown = [{ tool: "save_memory", status: "pending" }], status = "awaiting_approval") =>
  ({ id, status, pending, started_at: new Date(now - hoursAgo * H).toISOString(), created_at: new Date(now - hoursAgo * H - 60_000).toISOString() });

test("expiry window: default 48 h, configurable, 0 = off", () => {
  assert.equal(expiryMs({}), 48 * H);
  assert.equal(expiryMs({ ORBIT_APPROVAL_EXPIRY_HOURS: "24" }), 24 * H);
  assert.equal(expiryMs({ ORBIT_APPROVAL_EXPIRY_HOURS: "0" }), 0);
  assert.equal(expiryMs({ ORBIT_APPROVAL_EXPIRY_HOURS: "nope" }), 0);
});

test("only waiting tasks with a pending action, older than the window; off = none", () => {
  const rows = [row("old", 49), row("young", 47), row("done-actions", 60, [{ tool: "x", status: "approved" }]), row("running", 60, undefined, "running")];
  assert.deepEqual(dueExpiries(rows, now, 48 * H).map((r) => r.id), ["old"]);
  assert.deepEqual(dueExpiries(rows, now, 0), []);
});

test("the expired error reads as expired, with its window", () => {
  assert.ok(isExpiredError(EXPIRED_ERROR));
  assert.equal(expiredError(24 * H), "Expired: no answer in 24 h, so nothing was done.");
  assert.ok(isExpiredError(expiredError(24 * H)));
  assert.ok(!isExpiredError("You rejected the proposed actions; they were not completed."));
});
