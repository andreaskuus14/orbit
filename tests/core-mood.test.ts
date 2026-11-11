import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_MS, moodEvent, moodLook, newLook, newMoodCtx, resolveMood, toolTarget } from "../src/lib/core-mood-pure.ts";

const quiet = { listening: false, mic: 0, spk: 0, approval: false };

test("tools map to planets, web tools to the beam, the rest to plain thinking", () => {
  assert.equal(toolTarget("web_search"), "web");
  assert.equal(toolTarget("fetch_url"), "web");
  assert.equal(toolTarget("search_memory"), "memory");
  assert.equal(toolTarget("run_scout"), "studio");
  assert.equal(toolTarget("think"), null);
  assert.equal(toolTarget("nonsense"), null);
});

test("a CORE answer walks idle -> thinking -> searching -> tool -> idle", () => {
  const c = newMoodCtx();
  assert.equal(resolveMood(c, 0, quiet), "idle");
  moodEvent(c, { type: "busy", on: true }, 0);
  assert.equal(resolveMood(c, 0, quiet), "thinking");
  moodEvent(c, { type: "step", tool: "web_search" }, 0);
  assert.equal(resolveMood(c, 0, quiet), "searching");
  moodEvent(c, { type: "step", tool: "save_memory" }, 0);
  assert.equal(resolveMood(c, 0, quiet), "tool");
  moodEvent(c, { type: "step", tool: "think" }, 0);
  assert.equal(resolveMood(c, 0, quiet), "thinking");
  moodEvent(c, { type: "busy", on: false }, 0);
  assert.equal(resolveMood(c, 0, quiet), "idle");
  assert.equal(c.target, null);
});

test("priority: error, speaking, listening, the work, then approval over idle", () => {
  assert.equal(resolveMood(newMoodCtx(), 0, { ...quiet, approval: true }), "approval");
  const c = moodEvent(newMoodCtx(), { type: "busy", on: true }, 0);
  assert.equal(resolveMood(c, 0, { ...quiet, approval: true }), "thinking");
  assert.equal(resolveMood(c, 0, { ...quiet, mic: 0.5 }), "listening");
  assert.equal(resolveMood(c, 0, { ...quiet, listening: true, spk: 0.3 }), "speaking");
  moodEvent(c, { type: "error" }, 1000);
  assert.equal(resolveMood(c, 1000 + ERROR_MS / 2, { ...quiet, approval: true }), "error");
  assert.equal(resolveMood(c, 1000 + ERROR_MS, quiet), "thinking"); // brief
});

test("looks: one cue per state, written in place, all finite", () => {
  const out = newLook();
  for (const m of ["idle", "listening", "thinking", "searching", "tool", "approval", "speaking", "error"] as const) {
    assert.equal(moodLook(m, out), out);
    for (const v of Object.values(out)) assert.ok(Number.isFinite(v) && v >= 0);
  }
  assert.equal(moodLook("searching", out).beam, 1);
  assert.equal(moodLook("thinking", out).beam, 0);
  assert.equal(moodLook("tool", out).tint, 1);
  assert.equal(moodLook("approval", out).amber, 1);
  assert.equal(moodLook("speaking", out).ripple, 1);
  assert.equal(moodLook("error", out).desat, 1);
  assert.equal(moodLook("listening", out).face, 1);
  assert.ok(moodLook("idle", out).breath < moodLook("thinking", out).breath);
});
