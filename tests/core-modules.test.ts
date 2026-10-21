import { test } from "node:test";
import assert from "node:assert/strict";
import { businessLine, ideasLine, modulePrompt, privateTools, statusBlock, toolModule, writeTools } from "../src/lib/core-modules-pure.ts";

test("registry: lookup, prompt, private and write tools come from the module list", () => {
  const mods = [{ name: "A", prompt: "- a", tools: ["a1", "a2"], private: true, writes: ["a2"] }, { name: "B", prompt: "- b", tools: ["b1"] }];
  assert.equal(toolModule(mods, "a2")?.name, "A");
  assert.equal(toolModule(mods, "zz"), undefined);
  assert.equal(modulePrompt(mods), "- a\n- b");
  assert.deepEqual(privateTools(mods), ["a1", "a2"]);
  assert.deepEqual(writeTools(mods), ["a2"]);
});

test("status block skips empty lines and is empty when nothing to say", () => {
  assert.equal(statusBlock([{ name: "A", line: "" }]), "");
  assert.match(statusBlock([{ name: "A", line: "" }, { name: "B", line: "2 due" }]), /^LIVE STATUS[^\n]*\n- B: 2 due\n\n$/);
});

test("business and ideas lines", () => {
  const now = Date.parse("2026-10-21T12:00:00Z"), old = "2026-10-10T12:00:00Z";
  const ps = [{ stage: "lead", fee: 0, updated_at: old, notes: "" }, { stage: "contacted", fee: 0, updated_at: old, notes: "" }] as never[];
  assert.equal(businessLine(ps, now), "2 in pipeline, 1 to contact, 0 replied, 0 pilots, 1 follow-up due");
  assert.equal(businessLine([], now), "");
  assert.equal(ideasLine([{ title: "Old", at: old, sourceAt: "2026-09-01" }], now), "");
  assert.match(ideasLine([{ title: "New", at: "2026-10-21T10:00:00Z", sourceAt: "2026-10-20" }], now), /^1 fresh idea on the board/);
});
