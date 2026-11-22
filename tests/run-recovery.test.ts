import { test } from "node:test";
import assert from "node:assert/strict";
import { lastRunFailing, liveFailures, PROBLEM_MAX_AGE_MS, pruneMarks, requeuePatch, restartRerun, RETRY_MARK_MS } from "../src/lib/run-recovery-pure.ts";
import { needsYou } from "../src/lib/needs-you-pure.ts";
import { continueWork } from "../src/lib/work-continuation-pure.ts";
import { isNetworkError, pickNetRetries } from "../src/lib/net-wait-pure.ts";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

test("restart: a cut-off task starts again by itself once, only when that repeats nothing", () => {
  const t = { id: "a", title: "⚙ Daily business loop", pending: [] };
  assert.equal(restartRerun(t, new Set()), true);
  assert.equal(restartRerun(t, new Set(["a"])), false, "only once");
  assert.equal(restartRerun({ ...t, pending: [{ status: "pending" }] }, new Set()), true, "an unanswered approval was never acted on");
  for (const status of ["approved", "attempting", "uncertain", "failed", "rejected"]) assert.equal(restartRerun({ ...t, pending: [{ status }] }, new Set()), false, status);
  assert.equal(restartRerun({ ...t, children: 1 }, new Set()), false, "sub-tasks may have done things");
  assert.equal(restartRerun({ ...t, title: "Team: Launch" }, new Set()), false);
  assert.equal(restartRerun({ ...t, title: "Goal step 2 · x" }, new Set()), false);
  assert.deepEqual(requeuePatch(), { status: "queued", error: null, result: null, trace: [], pending: [], started_at: null, finished_at: null });
});

test("retry marks: old, future and junk entries are dropped", () => {
  assert.deepEqual(pruneMarks({ a: NOW - 1000, b: NOW - RETRY_MARK_MS - 1, c: NOW + 5000, d: "x" }, NOW), { a: NOW - 1000 });
  assert.deepEqual(pruneMarks(null, NOW), {});
  assert.deepEqual(pruneMarks("junk", NOW), {});
});

test("live failures: superseded, older than 24 h and repeated runs of one automation drop out", () => {
  const runs = [
    { id: "mb2", at: iso(2), automation: "mb" }, { id: "mb1", at: iso(5), automation: "mb" }, // Morning Brief ×2 → one
    { id: "loop", at: iso(3), automation: "loop", superseded: true }, // a later run finished
    { id: "old", at: iso(30) }, { id: "res", at: iso(1) }, { id: "noTime" },
  ];
  assert.deepEqual(liveFailures(runs, NOW).map((r) => r.id), ["mb2", "res", "noTime"]);
  assert.ok(PROBLEM_MAX_AGE_MS === 24 * 3_600_000);
});

test("Needs you: an automation's old failure is no problem once a newer run finished (still listed in Continue work)", () => {
  const tasks = [
    { id: "f1", title: "⚙ Morning Brief", status: "failed", created_at: iso(6), started_at: iso(6), error: "Interrupted: ORBIT restarted while this ran.", automation_id: "mb" },
    { id: "r1", title: "Research Roblox tools", status: "failed", created_at: iso(40), started_at: iso(40), error: "fetch failed" },
    { id: "f2", title: "⚙ Daily YouTube ideas", status: "failed", created_at: iso(1), started_at: iso(1), error: "boom", automation_id: "yt" },
  ];
  const work = continueWork(tasks, [], [], [], { mb: { at: iso(2), verified: true } });
  assert.equal(work.items.length, 3, "OPERATIONS history keeps all three");
  assert.equal(work.items.find((i) => i.id === "f1")?.superseded, true);
  const needs = needsYou({ work: work.items, now: NOW });
  assert.deepEqual(needs.map((n) => n.ref), ["task:f2"], "only today's real failure remains");
});

test("SYSTEM automations: the latest run failing counts for 24 h", () => {
  assert.equal(lastRunFailing({ status: "failed", finished_at: iso(1) }, NOW), true);
  assert.equal(lastRunFailing({ status: "failed", finished_at: iso(25) }, NOW), false);
  assert.equal(lastRunFailing({ status: "done", finished_at: iso(1) }, NOW), false);
  assert.equal(lastRunFailing(null, NOW), false);
});

test("offline: the Claude CLI's connection errors count as no internet; his own tasks retry too, goal steps don't", () => {
  for (const m of ["API Error: Connection error.", "Claude Code failed: Unable to connect to API (ConnectionRefused)", "net::ERR_INTERNET_DISCONNECTED"]) assert.equal(isNetworkError(m), true, m);
  assert.equal(isNetworkError("API Error: 400 invalid request"), false);
  const row = (id: string, title: string) => ({ id, title, error: "API Error: Connection error.", finished_at: iso(0.1), pending: [] });
  assert.deepEqual(pickNetRetries([row("a", "Research Roblox tools"), row("b", "Goal step 1 · x"), row("c", "Team: x")], new Map(), NOW), ["a"]);
});
