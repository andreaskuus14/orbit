import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxBucket, inboxView, type InboxTask } from "../src/lib/operations-inbox-pure.ts";
const task = (id: string, status: string, extra: Partial<InboxTask> = {}): InboxTask => ({ id, status, title: id, agent: "atlas", created_at: "2026-11-01T12:00:00Z", ...extra });

test("inbox separates cancelled work from finished work and surfaces uncertainty", () => {
  const rows = [task("approval", "awaiting_approval"), task("failure", "failed"), task("active", "running"), task("done", "done"), task("cancelled", "cancelled"), task("uncertain", "running", { pending: [{ status: "uncertain" }] })];
  const v = inboxView(rows, "", "", "all", "priority");
  assert.deepEqual(v.counts, { attention: 1, failed: 2, active: 1, done: 1, cancelled: 1 });
  assert.equal(Object.values(v.counts).reduce((a, b) => a + b, 0), rows.length);
  assert.deepEqual(inboxView(rows, "", "", "done", "recent").rows.map((t) => t.id), ["done"]);
  assert.equal(inboxBucket(task("unknown", "new-status")), "attention");
});

test("search combines words across title, request, result and error, with an independent agent filter", () => {
  const rows = [task("a", "done", { title: "Tallinn report", request: "Research transport", result: "Õhtune kokkuvõte" }), task("b", "failed", { title: "Report", error: "Transport timeout", agent: "forge" })];
  assert.deepEqual(inboxView(rows, "  REPORT transport  ", "", "all", "priority").rows.map((t) => t.id), ["b", "a"]);
  assert.deepEqual(inboxView(rows, "ÕHTUNE", "atlas", "all", "recent").rows.map((t) => t.id), ["a"]);
  const v = inboxView(rows, "transport", "forge", "done", "recent");
  assert.equal(v.rows.length, 0); assert.equal(v.counts.failed, 1); assert.equal(v.total, 1);
  assert.equal(inboxView(rows, "not found", "", "all", "recent").total, 0);
});

test("priority and recent sorting use last progress, keep ties stable, and never mutate input", () => {
  const rows = [task("z", "done", { finished_at: "2026-11-02T12:00:00Z" }), task("b", "awaiting_approval"), task("a", "awaiting_approval"), task("invalid", "done", { created_at: "bad" })];
  const before = structuredClone(rows);
  assert.deepEqual(inboxView(rows, "", "", "all", "priority").rows.map((t) => t.id), ["a", "b", "z", "invalid"]);
  assert.deepEqual(inboxView(rows, "", "", "all", "recent").rows.map((t) => t.id), ["z", "a", "b", "invalid"]);
  assert.deepEqual(rows, before);
  assert.deepEqual(inboxView([], "", "", "all", "priority").rows, []);
});
