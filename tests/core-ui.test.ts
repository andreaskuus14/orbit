import { test } from "node:test";
import assert from "node:assert/strict";
import { pickModel, stepLabel, followUps } from "../src/lib/core-ui.ts";

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
