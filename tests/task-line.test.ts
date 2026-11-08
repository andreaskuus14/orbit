import { test } from "node:test";
import assert from "node:assert/strict";
import { medianByAgent, runSeconds, taskLine } from "../src/lib/task-line-pure.ts";

test("taskLine gives agents times, run length and the error, not just a date", () => {
  const done = { title: "Research", agent: "atlas", status: "done", created_at: "2026-11-08T02:31:10Z", started_at: "2026-11-08T02:31:12Z", finished_at: "2026-11-08T02:34:06Z" };
  assert.equal(taskLine(done), "- Research (atlas, done, created 2026-11-08 02:31 UTC, ran 2m 54s)");
  assert.equal(taskLine({ ...done, status: "running", finished_at: null }), "- Research (atlas, running, created 2026-11-08 02:31 UTC, started 2026-11-08 02:31 UTC)");
  assert.equal(taskLine({ ...done, status: "failed", error: "Interrupted\n(ORBIT restarted)" }), "- Research (atlas, failed, created 2026-11-08 02:31 UTC, ran 2m 54s) — error: Interrupted (ORBIT restarted)");
  assert.equal(taskLine({ title: "Old", agent: "nova", status: "queued", created_at: "2026-10-16T14:00:13.115+00:00" }), "- Old (nova, queued, created 2026-10-16 14:00 UTC)");
});

test("runSeconds and medianByAgent ignore unfinished or broken rows", () => {
  assert.equal(runSeconds({ started_at: null, finished_at: "2026-11-08T00:00:00Z" }), null);
  assert.equal(runSeconds({ started_at: "2026-11-08T00:01:00Z", finished_at: "2026-11-08T00:00:00Z" }), null);
  const rows = [
    { agent: "atlas", started_at: "2026-11-08T00:00:00Z", finished_at: "2026-11-08T00:02:00Z" },
    { agent: "atlas", started_at: "2026-11-08T00:00:00Z", finished_at: "2026-11-08T00:03:00Z" },
    { agent: "atlas", started_at: "2026-11-08T00:00:00Z", finished_at: "2026-11-08T00:01:00Z" },
    { agent: "forge", started_at: "2026-11-08T00:00:00Z", finished_at: "2026-11-08T00:00:43Z" },
    { agent: "forge", started_at: null, finished_at: null },
  ];
  assert.equal(medianByAgent(rows), "atlas 2m 0s (n=3), forge 43s (n=1)");
  assert.equal(medianByAgent([]), "none");
});
