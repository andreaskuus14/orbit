import { test } from "node:test";
import assert from "node:assert/strict";
import { afterTimeout, callTimeout, chunkPlan, handoffReply, isHeavy, isTimeout, progressLabel, CHAT_MS, GEN_MS } from "../src/lib/long-work-pure.ts";
import { stepLabel } from "../src/lib/core-ui.ts";

test("timeout by purpose, capped by the turn", () => {
  assert.equal(callTimeout(false, 270_000), CHAT_MS);
  assert.equal(callTimeout(true, 270_000), 255_000); // interactive: all the turn has left, not 2 min
  assert.equal(callTimeout(true, 20 * 60_000), GEN_MS); // background: 9 min
  assert.equal(callTimeout(true, 10_000), 20_000);
});

test("heavy work: build/research asks and long tools", () => {
  assert.ok(isHeavy("build me a portfolio website", []));
  assert.ok(isHeavy("research EU battery rules", []));
  assert.ok(isHeavy("ok", ['You called ws_write {"workspace":"x"}\nRESULT:\nok']));
  assert.ok(!isHeavy("what time is it", []));
});

test("timeout → retry split once, then hand off", () => {
  assert.ok(isTimeout(new Error("Claude Code timed out after 2 minutes")));
  assert.ok(!isTimeout(new Error("usage limit")));
  assert.equal(afterTimeout(false, 150_000), "retry");
  assert.equal(afterTimeout(true, 150_000), "handoff");
  assert.equal(afterTimeout(false, 60_000), "handoff");
});

test("chunk plan: at most 3 calls, all files", () => {
  assert.deepEqual(chunkPlan(0), []);
  assert.deepEqual(chunkPlan(2), [2]);
  assert.deepEqual(chunkPlan(6), [3, 3]);
  assert.deepEqual(chunkPlan(20), [6, 7, 7]);
});

test("progress label and handoff reply", () => {
  assert.equal(progressLabel("ws_write", { files: [1, 2, 3, 4, 5, 6] }), "Writing 6 files…");
  assert.equal(stepLabel("ws_write", { files: [1] }), "Writing 1 file…");
  assert.match(handoffReply("abc", "en"), /background.*#o=operations&k=task&id=abc/);
  assert.match(handoffReply("abc", "et"), /taustal/);
  assert.doesNotMatch(handoffReply("abc", "en"), /timed out/);
});

test("out of steps before the request is done: hand off, then at most 2 extra budgets, never 'next message'", async () => {
  const { afterBudget, stripMore, EXTRA_BUDGETS, MORE_ASK } = await import("../src/lib/long-work-pure.ts");
  const notDone = "[continue] 1 of 5 leads saved; 4 sites left to check.", live = "The request is not fully done… I'll continue on your next message.";
  assert.equal(EXTRA_BUDGETS, 2); assert.match(MORE_ASK, /\[continue\]/);
  assert.equal(afterBudget(notDone, { background: false, extra: 0, leftMs: 30_000 }), "handoff");
  assert.equal(afterBudget(live, { background: false, extra: 0, leftMs: 30_000 }), "handoff");
  assert.equal(afterBudget("Jätkan su järgmise sõnumi peale.", { background: false, extra: 0, leftMs: 30_000 }), "handoff");
  assert.equal(afterBudget(notDone, { background: true, extra: 1, leftMs: 600_000 }), "extend");
  assert.equal(afterBudget(notDone, { background: true, extra: 1, leftMs: 60_000 }), "stop"); // no time left for another budget
  assert.equal(afterBudget(notDone, { background: true, extra: 2, leftMs: 600_000 }), "stop"); // cap reached
  assert.equal(afterBudget("Added all 5 leads.", { background: false, extra: 0, leftMs: 200_000 }), "stop");
  assert.equal(stripMore(notDone), "1 of 5 leads saved; 4 sites left to check.");
  const { readFile } = await import("node:fs/promises");
  const core = await readFile(new URL("../src/lib/core.ts", import.meta.url), "utf8");
  assert.match(core, /if \(more === "handoff"\) throw new CoreHandoff/); assert.match(core, /extra: store\.extra/); // the background run keeps the count
});
