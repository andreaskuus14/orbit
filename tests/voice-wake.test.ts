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
  for (const t of ["all right shut down", "Shut down", "go to sleep now", "All right, Orbit shut down", "Orbit, shut down.", "orbit go to sleep", "Close Orbit", "goodbye orbit", "orbital shutdown"]) assert.ok(isSleepCommand(t), t);
  for (const t of ["How do I shut down my PC?", "Orbit, what's the news?", "close the memory panel"]) assert.equal(isSleepCommand(t), false, t);
});

test("a bare 'orbit' wakes only at the start of what was said", () => {
  assert.deepEqual(extractWakeQuestion("Orbit, what's the news?"), { question: "What's the news?" });
  assert.deepEqual(extractWakeQuestion("orbit"), { question: "" });
  assert.equal(extractWakeQuestion("the moon's orbit is elliptical"), null);
});

const REAL = [
  "hey orbit what's the weather", "Hey Orbit.", "hey, orbit, what time is it", "Okay Orbit, remind me of my tasks", "ok orbit how are you",
  "OK Orbit open the galaxy", "hay orbit what's up", "hi orbit", "hey orbits tell me a joke", "um a orbit what time is it", "Orbit, what's the news?",
  "orbit", "Orbit.", "Orbit! Are you there?", "orbit what's on my calendar", "orbit open settings", "Orbit, shut down.", "Orbit, is it raining?",
  "orbit what is the capital of Estonia", "orbit how many tasks do I have", "Orbit play some music", "orbit show me the galaxy", "hey orbit is it raining",
  "hey orbit of the moon", "okay orbit, are you there", "ok, orbit, what's next", "Hey Orbit, summarize my day", "hey, orbit.", "hey orbit?",
  "hey or bit what time is it", "hey or bit", "Hey or bit.", "okay or bit, open the galaxy", "ok or bit remind me", "or bit, what's the weather",
  "Or bit. What's the news?", "hay or bit", "hey or-bit what's up", "a or bit what time is it", "hi or bit", "hey orbit, kuidas läheb", "orbit, mis kell on",
  "hi, orbit", "Orbit, tere", "hey orbit what's the time", "Orbit what time is it", "orbit tell me a joke", "HEY ORBIT", "hey  orbit   what's up", "hey orbit please open mail",
];
const NEAR = [
  "orbital mechanics is hard", "hey orbital mechanics", "the orbit of the moon", "Orbit of the moon is nearly circular", "Orbit is a path around a planet",
  "Orbit around the earth takes ninety minutes", "orbit was changed twice", "or bit by bit we got there", "Or bit of cheese for lunch", "or bit more time please",
  "Orbiting the earth, I saw the sea", "orbits are elliptical", "Orbits of comets vary", "the satellite's orbit decays", "hey orbital", "a orbital path",
  "He did it bit by bit", "Orbit and gravity are linked", "Orbit will decay in a year", "orbit has changed",
];

test("50 real wake phrasings, including Whisper's 'or bit', all wake", () => {
  assert.equal(REAL.length, 50);
  for (const t of REAL) assert.ok(extractWakeQuestion(t), t);
  assert.deepEqual(extractWakeQuestion("hey or bit what time is it"), { question: "What time is it" });
});

test("near-misses do not wake", () => {
  for (const t of NEAR) assert.equal(extractWakeQuestion(t), null, t);
});

test("false-accept rate on 10,000 real sentences stays under 0.05%", async () => {
  const { readFileSync } = await import("node:fs");
  const lines = readFileSync(new URL("./fixtures/wake-corpus.txt", import.meta.url), "utf8").split("\n").filter(Boolean);
  assert.ok(lines.length >= 9900);
  const hits = lines.filter((l) => extractWakeQuestion(l));
  assert.ok(hits.length / lines.length <= 0.0005, `${hits.length} false accepts: ${hits.slice(0, 5).join(" | ")}`);
});

test("a lone 'or bit' wakes, 'or bit more' does not", () => {
  assert.deepEqual(extractWakeQuestion("or bit"), { question: "" });
  assert.equal(extractWakeQuestion("or bit more"), null);
});
