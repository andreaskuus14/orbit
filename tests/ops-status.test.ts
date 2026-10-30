import { test } from "node:test";
import assert from "node:assert/strict";
import { HOST_STALE_MS, hostOffline, lastProgress, opsStatus } from "../src/lib/ops-status-pure.ts";

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

test("running work whose host stopped beating reads blocked (interrupted), not running", () => {
  const now = Date.parse("2026-10-30T12:00:00Z"), ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(hostOffline(undefined, now), false, "not loaded yet: no claim");
  assert.equal(hostOffline(null, now), true, "never beaten: scheduler not running");
  assert.equal(hostOffline(ago(60_000), now), false);
  assert.equal(hostOffline(ago(HOST_STALE_MS + 1), now), true);
  assert.equal(hostOffline("garbage", now), true);
  assert.equal(opsStatus("running", { hostOffline: true }), "blocked");
  assert.equal(opsStatus("running", { hostOffline: true, pending: [{ status: "uncertain" }] }), "blocked");
  assert.equal(opsStatus("queued", { hostOffline: true }), "queued");
  assert.equal(opsStatus("done", { hostOffline: true }), "complete");
  assert.equal(opsStatus("running", { hostOffline: false }), "running");
});
