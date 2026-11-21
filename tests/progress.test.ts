import { test } from "node:test";
import assert from "node:assert/strict";
import { doneShare, fromNeed, fromPlanJob, fromStages, fromTask, leftText, minutesLeft, plainStep, sortProgress, statusLine, stepsFrom } from "../src/lib/progress-pure.ts";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const task = (o: Record<string, unknown>) => ({ id: "t1", title: "Research cafés", status: "running", created_at: "2026-11-21T11:50:00Z", started_at: "2026-11-21T11:55:00Z", ...o });

test("stepsFrom marks done / now / next and a failed current step", () => {
  assert.deepEqual(stepsFrom(["a", "b", "c"], 1).map((s) => s.state), ["done", "now", "next"]);
  assert.deepEqual(stepsFrom(["a", "b"], 1, true).map((s) => s.state), ["done", "failed"]);
  assert.deepEqual(stepsFrom(["a", "b"], 9).map((s) => s.state), ["done", "done"]);
});

test("plainStep never shows an internal tool name", () => {
  assert.equal(plainStep("web_search", "en"), "Searching the web");
  assert.equal(plainStep("ws_write", "et"), "Kirjutan faile");
  assert.equal(plainStep("zz_internal_tool", "en"), "Working");
});

test("running task: trace becomes plain steps, the last one is now, plus Finishing up", () => {
  const p = fromTask(task({ trace: [{ step: "sdk" }, { step: "web_search" }, { step: "web_search" }, { step: "fetch_url" }] }), "en", { nowMs: NOW, typicalMs: 10 * 60_000 });
  assert.equal(p.phase, "working");
  assert.deepEqual(p.steps.map((s) => `${s.state}:${s.label}`), ["done:Searching the web", "now:Reading pages", "next:Finishing up"]);
  assert.equal(p.now, "Reading pages");
  assert.equal(p.leftMin, 5);
  assert.equal(p.action, null);
});

test("awaiting approval asks with one Approve that opens the task (never approves itself)", () => {
  const p = fromTask(task({ status: "awaiting_approval" }), "en", { nowMs: NOW });
  assert.equal(p.phase, "needs");
  assert.equal(p.action?.label, "Approve");
  assert.match(p.action!.open, /^#o=operations&k=task&id=t1$/);
  assert.equal(p.leftMin, null);
});

test("done task shows the first line of the result; failed shows the error and Try again", () => {
  const d = fromTask(task({ status: "done", finished_at: "2026-11-21T11:58:00Z", result: "## Found 5 quiet cafés\nmore" }), "en", { nowMs: NOW });
  assert.equal(d.phase, "done");
  assert.equal(d.result?.text, "Found 5 quiet cafés");
  assert.ok(d.steps.every((s) => s.state === "done"));
  const f = fromTask(task({ status: "failed", error: "Usage limit reached" }), "en", { nowMs: NOW });
  assert.equal(f.phase, "failed");
  assert.equal(f.result?.text, "Usage limit reached");
  assert.equal(f.action?.kind, "retry");
});

test("Stop-all holds queued and running work: waiting, never shown as working", () => {
  const p = fromTask(task({}), "en", { nowMs: NOW, stopAll: true });
  assert.equal(p.phase, "waiting");
  assert.equal(p.now, "Paused by Stop-all");
});

test("minutesLeft: no basis gives null, overdue never below 1", () => {
  assert.equal(minutesLeft(null, NOW, null), null);
  assert.equal(minutesLeft("2026-11-21T11:00:00Z", NOW, 60_000), 1);
  assert.equal(minutesLeft(null, NOW, 10 * 60_000, 0.5), 5);
  assert.equal(leftText(1, "en"), "almost done");
  assert.equal(leftText(4, "en"), "about 4 min left");
  assert.equal(leftText(null, "en"), "");
});

test("fromStages: a clip render in its second stage", () => {
  const p = fromStages({ id: "c1", title: "Short: the jump", stages: ["Finding the moment", "Cutting", "Adding captions"], current: 1, typicalMs: 6 * 60_000, at: "2026-11-21T11:59:00Z" }, "en", NOW);
  assert.equal(p.phase, "working");
  assert.equal(p.now, "Cutting");
  assert.equal(p.leftMin, 4);
  assert.equal(doneShare(p), 1 / 3);
  const n = fromStages({ id: "c2", title: "x", stages: ["a"], current: 1, needs: { kind: "pick", label: "Pick one", open: "#o=studio" }, at: "2026-11-21T11:00:00Z" }, "en", NOW);
  assert.equal(n.phase, "needs");
});

test("fromPlanJob: failed step, and finished job", () => {
  const p = fromPlanJob({ id: "j", title: "Site", status: "active", updatedAt: "2026-11-21T10:00:00Z", steps: [{ text: "A", status: "done" }, { text: "B", status: "failed" }] }, "en");
  assert.equal(p.phase, "failed");
  const d = fromPlanJob({ id: "j", title: "Site", status: "done", updatedAt: "2026-11-21T10:00:00Z", steps: [{ text: "A", status: "done" }] }, "en");
  assert.equal(d.phase, "done");
});

test("sortProgress puts needs first; statusLine reads in plain words", () => {
  const a = fromTask(task({ id: "a" }), "en", { nowMs: NOW });
  const b = fromTask(task({ id: "b", status: "awaiting_approval" }), "en", { nowMs: NOW });
  const c = fromTask(task({ id: "c", status: "done", finished_at: "2026-11-21T11:00:00Z" }), "en", { nowMs: NOW });
  assert.deepEqual(sortProgress([c, a, b]).map((x) => x.id), ["b", "a", "c"]);
  assert.equal(statusLine([a, b, c], "en", NOW), "Working on 1 thing · 1 needs you · 1 done today");
  assert.equal(statusLine([], "en", NOW), "Nothing running. Tell ORBIT what you need.");
});

test("statusLine counts the whole Needs-you inbox when given", () => {
  assert.equal(statusLine([], "en", NOW, 2), "2 need you");
});

test("fromNeed: decide waits for him, failed blocker is failed, a result to check is done", () => {
  const n = (kind: "decide" | "unblock" | "review", cause = "approval") => ({ ref: "r", kind, cause, title: "Post 3 Shorts", detail: "Ready" });
  assert.equal(fromNeed(n("decide"), "Approve this exact version?", "Review").phase, "needs");
  assert.equal(fromNeed(n("unblock", "failed"), "Retry?", "Open").phase, "failed");
  assert.equal(fromNeed(n("review", "review"), "Looks right?", "Open").phase, "done");
  assert.equal(fromNeed(n("decide"), "Q?", "Review").result?.text, "Ready. Q?");
});
