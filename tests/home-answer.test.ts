import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_MAX, homeText, startAnswer, statusLine, step } from "../src/lib/home-answer-pure.ts";

test("home answer: thinking → tool → writing → done, keeping the conversation id for Continue in chat", () => {
  let s = startAnswer("What's on today?");
  assert.equal(statusLine(s), "Thinking…");
  s = step(s, { type: "start", conversationId: "c1" });
  s = step(s, { type: "step", tool: "calendar", label: "Reading your calendar" });
  assert.equal(s.phase, "tool");
  assert.equal(statusLine(s), "Reading your calendar");
  s = step(s, { type: "step_done" });
  s = step(s, { type: "delta", text: "Two things " });
  s = step(s, { type: "delta", text: "today." });
  assert.equal(s.phase, "writing");
  assert.equal(s.text, "Two things today.");
  s = step(s, { type: "done", answer: "Two things today [1]." });
  assert.deepEqual([s.phase, s.text, s.conversationId], ["done", "Two things today [1].", "c1"]);
});

test("home answer: a reset clears the draft; a handoff stays handed until bg_done; errors show their message", () => {
  let s = step(step(startAnswer("q", "c0"), { type: "delta", text: "draft" }), { type: "reset" });
  assert.equal(s.text, "");
  assert.equal(s.conversationId, "c0", "a follow-up keeps its conversation");
  s = step(s, { type: "background", taskId: "t9" });
  assert.equal(statusLine(s), "Working on it in the background. It will show up in Jobs.");
  assert.equal(step(s, { type: "done" }).phase, "handed");
  assert.equal(step(s, { type: "bg_done", answer: "Finished." }).text, "Finished.");
  assert.equal(statusLine(step(startAnswer("q"), { type: "error", error: "Usage limit" })), "Usage limit");
});

test("homeText: short answers whole; long ones cut at a line or word with an ellipsis", () => {
  assert.deepEqual(homeText("short"), { text: "short", cut: false });
  const long = `${"word ".repeat(200)}`;
  const r = homeText(long);
  assert.ok(r.cut && r.text.length <= HOME_MAX + 2 && r.text.endsWith("…") && !/wor …$/.test(r.text));
});
