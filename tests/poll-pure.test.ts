import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, pollMs, shouldPoll } from "../src/lib/poll-pure.ts";

test("pollMs floors status at 60 s and live at 2 s", () => {
  assert.equal(pollMs(5_000), 60_000);
  assert.equal(pollMs(300_000), 300_000);
  assert.equal(pollMs(500, "live"), 2_000);
  assert.equal(pollMs(3_000, "live"), 3_000);
});

test("shouldPoll needs enabled, on-screen world and visible tab", () => {
  assert.equal(shouldPoll({ enabled: true, paused: false, hidden: false }), true);
  assert.equal(shouldPoll({ enabled: true, paused: true, hidden: false }), false);
  assert.equal(shouldPoll({ enabled: true, paused: false, hidden: true }), false);
  assert.equal(shouldPoll({ enabled: false, paused: false, hidden: false }), false);
});

test("dedupe shares one in-flight request per key and clears after settling", async () => {
  const m = new Map<string, Promise<unknown>>();
  let calls = 0;
  const run = () => { calls++; return new Promise<number>((r) => setTimeout(() => r(calls), 5)); };
  const [a, b] = await Promise.all([dedupe(m, "x", run), dedupe(m, "x", run)]);
  assert.equal(calls, 1); assert.equal(a, b); assert.equal(m.size, 0);
  await dedupe(m, "x", run); assert.equal(calls, 2);
  await assert.rejects(dedupe(m, "y", () => Promise.reject(new Error("no")))); assert.equal(m.size, 0);
});
