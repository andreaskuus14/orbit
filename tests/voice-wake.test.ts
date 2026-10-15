import { test } from "node:test";
import assert from "node:assert/strict";
import { extractWakeQuestion, normalizeTranscript } from "../src/components/voice/wake.ts";

test("normalizeTranscript collapses whitespace", () => {
  assert.equal(normalizeTranscript("  what   is\nthe time "), "what is the time");
});

test("extractWakeQuestion finds wake phrases and the question after them", () => {
  assert.deepEqual(extractWakeQuestion("hey orbit what's the weather"), { question: "What's the weather" });
  assert.deepEqual(extractWakeQuestion("Okay Orbit, remind me of my tasks"), { question: "Remind me of my tasks" });
  assert.deepEqual(extractWakeQuestion("ok orbit how are you"), { question: "How are you" });
  assert.deepEqual(extractWakeQuestion("hey orbits tell me a joke"), { question: "Tell me a joke" });
  assert.deepEqual(extractWakeQuestion("um a orbit what time is it"), { question: "What time is it" });
});

test("extractWakeQuestion: wake phrase alone means the next utterance is the question", () => {
  assert.deepEqual(extractWakeQuestion("Hey Orbit."), { question: "" });
  assert.deepEqual(extractWakeQuestion("hey orbit"), { question: "" });
});

test("extractWakeQuestion ignores speech without the wake phrase", () => {
  assert.equal(extractWakeQuestion("the orbit of mars"), null);
  assert.equal(extractWakeQuestion("hey orbital mechanics"), null);
  assert.equal(extractWakeQuestion(""), null);
});

test("isSleepCommand catches shut-down phrases but not ordinary questions", async () => {
  const { isSleepCommand } = await import("../src/components/voice/wake.ts");
  for (const t of ["All right, Orbit shut down", "Orbit, shut down.", "orbit go to sleep", "Close Orbit", "goodbye orbit", "orbital shutdown"]) assert.ok(isSleepCommand(t), t);
  for (const t of ["How do I shut down my PC?", "Orbit, what's the news?", "close the memory panel"]) assert.equal(isSleepCommand(t), false, t);
});
