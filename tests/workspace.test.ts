import { test } from "node:test";
import assert from "node:assert/strict";
import { pickView, todayQueue } from "../src/lib/workspace-pure.ts";
import type { Prospect } from "../src/lib/business-pure.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const p = (id: string, stage: Prospect["stage"], daysAgo: number, draft = "", notes = ""): Prospect =>
  ({ id, name: id, kind: "", contact: "", stage, fee: 0, notes, draft, created_at: "", updated_at: new Date(now - daysAgo * 86_400_000).toISOString() });

test("todayQueue: follow-ups due, then ready drafts, then leads to draft; oldest first", () => {
  const q = todayQueue([p("fresh", "contacted", 1, "x"), p("lead-new", "lead", 1), p("ready", "lead", 2, "hi"), p("due2", "contacted", 5, "x"),
    p("due9", "contacted", 9, "x"), p("replied", "contacted", 9, "x", "They replied yes"), p("pay", "paying", 30)], now);
  assert.deepEqual(q.map((i) => `${i.kind}:${i.id}`), ["followup:due9", "followup:due2", "send:ready", "draft:lead-new"]);
});

test("todayQueue caps the list", () => {
  assert.equal(todayQueue(Array.from({ length: 20 }, (_, i) => p(`l${i}`, "lead", i)), now).length, 8);
});

test("pickView keeps a known view and falls back to the first", () => {
  const v = ["today", "pipeline"] as const;
  assert.equal(pickView("pipeline", v), "pipeline");
  assert.equal(pickView("gone", v), "today");
  assert.equal(pickView(null, v), "today");
});
