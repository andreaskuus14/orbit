import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNavCommand, validateNav, navLabel, LOCAL_COUNTRY } from "../src/lib/nav-pure.ts";

const yes: [string, object][] = [
  ["go to local news", { panel: "intelligence", country: LOCAL_COUNTRY }],
  ["Show me my local news, please.", { panel: "intelligence", country: "Estonia" }],
  ["open intelligence", { panel: "intelligence" }],
  ["Hey Orbit, open the news", { panel: "intelligence" }],
  ["show me Estonia", { panel: "intelligence", country: "Estonia" }],
  ["show Estonia", { panel: "intelligence", country: "Estonia" }],
  ["show me news from Germany", { panel: "intelligence", country: "Germany" }],
  ["go to news in Germany", { panel: "intelligence", country: "Germany" }],
  ["show me German news", { panel: "intelligence", country: "Germany" }],
  ["open Europe news", { panel: "intelligence", region: "Europe" }],
  ["fly to the Middle East", { panel: "intelligence", region: "Middle East" }],
  ["show me news from the USA", { panel: "intelligence", country: "United States of America" }],
  ["take me to America", { panel: "intelligence", country: "United States of America" }],
  ["show me the U.S.", { panel: "intelligence", country: "United States of America" }],
  ["fly to the UK", { panel: "intelligence", country: "United Kingdom" }],
  ["show me Britain", { panel: "intelligence", country: "United Kingdom" }],
  ["take me to the studio", { panel: "studio" }],
  ["open youtube", { panel: "studio" }],
  ["open game dev", { panel: "creation" }],
  ["can you take me to the game lab", { panel: "creation" }],
  ["show my stats", { panel: "studio", view: "stats" }],
  ["show me my analytics", { panel: "studio", view: "stats" }],
  ["open analytics", { panel: "analytics" }],
  ["open the clip factory", { panel: "studio", view: "clips" }],
  ["go back to the galaxy", { panel: null }],
  ["go back", { panel: null }],
  ["take me home", { panel: null }],
  ["Orbit, open my notes", { panel: "memory" }],
  ["switch to agents", { panel: "agents" }],
  ["bring up my tasks", { panel: "operations" }],
  ["navigate to the vault", { panel: "vault" }],
  ["open life", { panel: "life" }],
  ["open core", { panel: "core" }],
  ["open my profile", { panel: "profile" }],
  ["please go to the memory planet now", { panel: "memory" }],
];

test("parseNavCommand understands clear navigation commands", () => {
  for (const [text, want] of yes) assert.deepEqual(parseNavCommand(text), want, text);
});

test("parseNavCommand leaves questions and other requests to CORE", () => {
  for (const text of [
    "what's going on in Germany?", "tell me about Estonia", "news about AI", "show me news about AI",
    "go to sleep", "orbit, shut down", "open the pod bay doors", "show me how to cook pasta",
    "what are my stats?", "how is the studio doing", "open https://example.com", "go", "show me",
    "open intelligence and tell me about Germany", "show me what's happening in Germany", "switch to 2d view",
    "remember that I like Estonia", "summarize the local news", "estonia", "the moon's orbit",
  ]) assert.equal(parseNavCommand(text), null, text);
});

test("validateNav accepts only allowlisted places", () => {
  assert.deepEqual(validateNav({ target: "intelligence", country: "Germany" }), { panel: "intelligence", country: "Germany" });
  assert.deepEqual(validateNav({ target: "studio", view: "clips" }), { panel: "studio", view: "clips" });
  assert.deepEqual(validateNav({ target: "game dev" }), { panel: "creation" });
  assert.deepEqual(validateNav({ target: "galaxy" }), { panel: null });
  assert.equal(validateNav({ target: "https://evil.example" }), null);
  assert.equal(validateNav({ target: 42, view: "admin" }), null);
});

test("navLabel reads naturally", () => {
  assert.equal(navLabel({ panel: "intelligence", country: "United States of America" }), "Intelligence → United States");
  assert.equal(navLabel({ panel: "studio", view: "stats" }), "Studio → Stats");
  assert.equal(navLabel({ panel: null }), "the galaxy");
});
