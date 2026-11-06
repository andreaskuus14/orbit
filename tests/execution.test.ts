import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSource, taskExecution, track } from "../src/lib/execution.ts";

// The real execution-evidence functions (execution.ts) that agents.ts, bg-resume.ts and resolvePending feed.
const BOOT = Date.parse("2026-11-06T08:00:00Z");
const after = "2026-11-06T09:00:00Z", before = "2026-11-06T07:00:00Z";

test("track: active while the work runs, cleared on release (also after a throw), counted for overlaps, idempotent", async () => {
  assert.equal(taskExecution("t1", after, BOOT), "unknown");
  const run = async (fail: boolean) => { const release = track("t1"); try { assert.equal(taskExecution("t1", after, BOOT), "active"); if (fail) throw new Error("x"); } finally { release(); } };
  await run(false);
  assert.equal(taskExecution("t1", after, BOOT), "unknown", "cleared after completion");
  await assert.rejects(run(true));
  assert.equal(taskExecution("t1", after, BOOT), "unknown", "cleared after an error");
  const a = track("t2"), b = track("t2");
  a(); a(); // idempotent: the second call does nothing
  assert.equal(taskExecution("t2", after, BOOT), "active", "still active while the overlapping run is going");
  b();
  assert.equal(taskExecution("t2", after, BOOT), "unknown");
});

test("registered worker sets count as active; boot time decides restart; age alone never makes a task inactive", () => {
  const running = new Set(["w1"]);
  registerSource("test-workers", (id) => running.has(id));
  assert.equal(taskExecution("w1", "2026-10-01T00:00:00Z", BOOT), "active", "started a month ago but its worker is alive");
  running.delete("w1");
  assert.equal(taskExecution("w1", before, BOOT), "restart", "started before this process booted");
  assert.equal(taskExecution("w1", null, BOOT), "restart");
  assert.equal(taskExecution("w1", after, BOOT), "unknown");
  registerSource("test-workers", () => false); // re-registering replaces (hot reload), doesn't stack
  running.add("w1");
  assert.equal(taskExecution("w1", after, BOOT), "unknown");
});
