import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReflex, clockReply } from "../src/lib/reflex-pure.ts";

test("greetings, thanks and clock questions are reflexes", () => {
  for (const s of ["hi", "Hello!", "hey core", "Hey there 👋", "yo", "tere", "good evening", "hi, how are you?", "Hello ORBIT, how's it going?"]) assert.equal(classifyReflex(s), "greet", s);
  for (const s of ["thanks", "Thank you!", "thx", "ok thanks", "great, thank you so much", "aitäh", "thanks core 🙏"]) assert.equal(classifyReflex(s), "thanks", s);
  for (const s of ["what time is it?", "What’s the time", "time?", "mis kell on"]) assert.equal(classifyReflex(s), "time", s);
  for (const s of ["what's the date?", "what day is it", "What is the date today?", "today's date"]) assert.equal(classifyReflex(s), "date", s);
});

test("anything with real content takes the full path", () => {
  for (const s of [
    "", "ok", "yes", "cool", "sure, do it", "hi, what did I save yesterday?", "thanks, now summarise the news",
    "what time is it in Tokyo?", "what is today?", "what time is my meeting", "what day is the deadline?", "hello world program in python",
    "good morning", // the morning briefing command (nav-pure), not a greeting
    "open studio", "hi\nwhat's up", "thanks ".repeat(20),
  ]) assert.equal(classifyReflex(s), null, s);
});

test("clock replies use the given local time", () => {
  const d = new Date(2026, 9, 23, 9, 5);
  assert.equal(clockReply("time", d), "It's 09:05.");
  assert.equal(clockReply("date", d), "Today is Friday, 23 October 2026.");
});

test("small talk is answered locally, in the user's language", async () => {
  const { smallTalkReply } = await import("../src/lib/reflex-pure.ts");
  assert.equal(smallTalkReply("thanks", "thanks!", false), "Anytime.");
  assert.equal(smallTalkReply("thanks", "aitäh", false), "Pole tänu!");
  assert.equal(smallTalkReply("greet", "tere", false), "Tere! Mis teeme?");
  assert.equal(smallTalkReply("greet", "hey", true), "Yes? What next?");
});
