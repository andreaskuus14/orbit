import { test } from "node:test";
import assert from "node:assert/strict";
import { pickModel, stepLabel, followUps, needsSelfReview } from "../src/lib/core-ui.ts";

test("pickModel: short chit-chat goes fast", () => {
  for (const q of ["hi", "Hey CORE!", "thanks", "thank you so much", "good morning", "what's the capital of France?", "how are you?", "no", "cool, nice one"])
    assert.equal(pickModel(q), "fast", q);
});

test("pickModel: tools, memories and long questions stay smart", () => {
  for (const q of [
    "what are my notes about the game?", "any news today?", "studio status", "run the scout", "ask atlas about rust",
    "remember that I like tea", "open the globe", "https://example.com", "what did I say yesterday?", "explain quantum computing",
    "why is the sky blue", "how do I bake bread", "summarise this", "go to memory",
    "tell me a long and detailed story about a dragon who lives in the mountains far away", "",
  ]) assert.equal(pickModel(q), "smart", q);
});

test("pickModel: yes to CORE's offer stays smart; plain yes is fast", () => {
  assert.equal(pickModel("yes please", "Want me to run the scout?"), "smart");
  assert.equal(pickModel("yes", "Done, the scout is running."), "fast");
});

test("stepLabel", () => {
  assert.equal(stepLabel("read_news"), "Reading news…");
  assert.equal(stepLabel("ask_agent", { agent: "atlas" }), "Asking Atlas…");
  assert.equal(stepLabel("search_memory"), "Searching memories…");
  assert.equal(stepLabel("mystery"), "Working…");
});

test("followUps: by tool, then question, max 3", () => {
  assert.deepEqual(followUps("how's the studio", ["search_memory", "think", "studio_status", "think"]), ["Review clips", "Run the scout", "What has worked best?"]);
  assert.deepEqual(followUps("latest news", ["read_news"]).slice(0, 2), ["More on this", "Open the globe"]);
  assert.deepEqual(followUps("go to studio", ["navigate"]), []);
  assert.deepEqual(followUps("hi", ["search_memory", "think"]), []);
  assert.ok(followUps("what should my next project idea be", []).includes("What should I do next?"));
  for (const t of ["studio_status", "learned", "read_news", "fetch_url", "ask_agent", "save_memory"]) assert.ok(followUps("x", [t]).length <= 3);
});

test("pickModel: deep for explicit asks and clearly hard, long requests", () => {
  for (const q of [
    "deep: what should I build next?", "think hard about this", "Think carefully: is my plan sound?", "a deep dive on my retention",
    "Plan a 6-week roadmap for my Roblox pet game: I have 5 hours a week, need trading, pets, eggs and a shop, and it must launch before the holidays without paid ads.",
    "Compare Supabase, Firebase and PocketBase for my app given offline sync, row-level security, a tiny budget, realtime updates and an easy migration path later on.",
  ]) assert.equal(pickModel(q), "deep", q.slice(0, 40));
  for (const q of [
    "compare tea and coffee", "plan my day", "hi", "what are my notes about the game?", "explain monads step by step", "x".repeat(601),
    "Tell me about all the planets in the solar system, what each one is made of, how big they are, how far from the sun, and which moons they have, in a fun way",
    "Give me a pancake recipe with fluffy texture, using buttermilk, eggs, flour, sugar and a pinch of salt, plus tips for flipping them and keeping them warm for the family",
  ]) assert.notEqual(pickModel(q), "deep", q.slice(0, 40));
});

test("needsSelfReview: only big top-level, unverified agent results", () => {
  assert.equal(needsSelfReview("short", 0, 0, false), false);
  assert.equal(needsSelfReview("x".repeat(1500), 0, 0, false), true);
  assert.equal(needsSelfReview("short", 3, 0, false), true);
  assert.equal(needsSelfReview("x".repeat(5000), 5, 1, false), false); // sub-task: the parent reviews
  assert.equal(needsSelfReview("x".repeat(5000), 5, 0, true), false); // research already cross-checked
});
