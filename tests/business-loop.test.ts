import { test } from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_LOOP, leadInput } from "../src/lib/business-loop-pure.ts";
import { validateAutomation } from "../src/lib/pure.ts";

test("the template is a valid daily automation whose prompt never sends", () => {
  const v = validateAutomation({ name: BUSINESS_LOOP.name, trigger: "schedule", schedule: { every: "day", hour: 9, minute: 15 }, agent: BUSINESS_LOOP.agent, prompt: BUSINESS_LOOP.prompt });
  assert.ok("spec" in v);
  for (const s of ["Find", "Verify", "Pick", "Demo site", "Pitch", "save_lead"]) assert.ok(BUSINESS_LOOP.prompt.includes(s), s);
  assert.match(BUSINESS_LOOP.prompt, /Never send anything yourself/);
});

test("leadInput: the pitch becomes the draft, website + evidence go to notes, the site is watched", () => {
  const r = leadInput({ name: "Kook OÜ", kind: "bakery", contact: "info@kook.ee", website: "https://kook.ee", evidence: "https://kook.ee (no mobile layout)", notes: "Demo: hero + menu", pitch: "Tere! I made a quick demo of a new site for you." });
  assert.ok(typeof r !== "string");
  assert.equal(r.draft, "Tere! I made a quick demo of a new site for you.");
  assert.match(r.notes, /^Website: https:\/\/kook\.ee\nEvidence: .+\nDemo: hero \+ menu$/);
  assert.equal(r.watch, "https://kook.ee");
  assert.equal(leadInput({ name: "", pitch: "x".repeat(30) }), "Give the business a name");
  assert.match(String(leadInput({ name: "A", pitch: "short" })), /^pitch/);
  assert.equal((leadInput({ name: "A", website: "not a url", pitch: "x".repeat(30) }) as { watch?: string }).watch, undefined);
});
