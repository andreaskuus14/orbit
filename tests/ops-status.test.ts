import { test } from "node:test";
import assert from "node:assert/strict";
import { lastProgress, opsStatus } from "../src/lib/ops-status-pure.ts";

test("task, chain and mission states map to one vocabulary", () => {
  const cases: [string, string][] = [
    ["queued", "queued"], ["running", "running"], ["awaiting_approval", "waiting"], ["done", "complete"], ["failed", "failed"], ["cancelled", "cancelled"], // task / step
    ["waiting", "waiting"], // chain
    ["waiting-input", "blocked"], ["waiting-approval", "waiting"], ["paused", "blocked"], ["completed", "complete"], // mission
    ["blocked", "blocked"], ["weird", "queued"], ["constructor", "queued"],
  ];
  for (const [raw, want] of cases) assert.equal(opsStatus(raw), want, raw);
});

test("stop-all holds queued and running work; it never looks running", () => {
  assert.equal(opsStatus("running", { stopAll: true }), "blocked");
  assert.equal(opsStatus("queued", { stopAll: true }), "blocked");
  assert.equal(opsStatus("done", { stopAll: true }), "complete");
  assert.equal(opsStatus("cancelled", { stopAll: true }), "cancelled");
});

test("a running task with an unconfirmed action is checking", () => {
  assert.equal(opsStatus("running", { pending: [{ status: "uncertain" }] }), "checking");
  assert.equal(opsStatus("running", { pending: [{ status: "approved" }] }), "running");
  assert.equal(opsStatus("failed", { pending: [{ status: "attempting" }] }), "failed");
});

test("last progress is the latest timestamp", () => {
  assert.equal(lastProgress("2026-01-01T00:00:00Z", null, "2026-01-02T00:00:00Z"), "2026-01-02T00:00:00.000Z");
  assert.equal(lastProgress(null, undefined, "x"), "");
});
