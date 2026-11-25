import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStamp, rollbackPlan, skipPulledCommit } from "../src/lib/rollback-pure.ts";

const prev = { commit: "aaa", lock: "L1" };

test("stamp parsing", () => {
  assert.deepEqual(parseStamp("aaa\r\nL1\r\n"), prev);
  assert.equal(parseStamp(""), null);
  assert.equal(parseStamp("aaa"), null);
  assert.equal(parseStamp(null), null);
});

test("no stamp on the old release -> only the .next swap (as before)", () => {
  assert.deepEqual(rollbackPlan({ prev: null, head: "bbb", lockNow: "L2", savedLock: "L1" }), { resetTo: null, deps: "keep" });
});

test("code-only update -> reset git, keep node_modules", () => {
  assert.deepEqual(rollbackPlan({ prev, head: "bbb", lockNow: "L1", savedLock: null }), { resetTo: "aaa", deps: "keep" });
});

test("lockfile changed and node_modules-prev matches -> reset + restore it", () => {
  assert.deepEqual(rollbackPlan({ prev, head: "bbb", lockNow: "L2", savedLock: "L1" }), { resetTo: "aaa", deps: "restore" });
});

test("lockfile changed, node_modules-prev missing or from another lock -> reset + npm ci", () => {
  assert.deepEqual(rollbackPlan({ prev, head: "bbb", lockNow: "L2", savedLock: null }), { resetTo: "aaa", deps: "reinstall" });
  assert.deepEqual(rollbackPlan({ prev, head: "bbb", lockNow: "L2", savedLock: "L0" }), { resetTo: "aaa", deps: "reinstall" });
});

test("same commit (launcher rebuild) -> no reset", () => {
  assert.deepEqual(rollbackPlan({ prev, head: "aaa", lockNow: "L1", savedLock: null }), { resetTo: null, deps: "keep" });
});

test("a rolled-back commit pulled again is skipped unless forced or main moved on", () => {
  assert.equal(skipPulledCommit("bad", "aaa", "bad", false), true);
  assert.equal(skipPulledCommit("bad", "aaa", "bad", true), false);
  assert.equal(skipPulledCommit("new", "aaa", "bad", false), false);
  assert.equal(skipPulledCommit("aaa", "aaa", "aaa", false), false);
  assert.equal(skipPulledCommit("bad", "aaa", null, false), false);
});
