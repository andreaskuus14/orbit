import { test } from "node:test";
import assert from "node:assert/strict";
import { fitSize, parseLookRequest, lookPrompt, robloxErrors } from "../src/lib/screen-look-pure.ts";

test("fitSize: downsizes the long edge, never upscales, survives bad input", () => {
  assert.deepEqual(fitSize(3840, 2160), { width: 1568, height: 882 });
  assert.deepEqual(fitSize(1080, 1920), { width: 882, height: 1568 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(0, 600), { width: 1, height: 1 });
  assert.deepEqual(fitSize(NaN, 10), { width: 1, height: 1 });
});

test("parseLookRequest: only an explicit ask, rest is the question, Roblox words pick the preset", () => {
  assert.deepEqual(parseLookRequest("look at my screen"), { question: "", preset: "general" });
  assert.deepEqual(parseLookRequest("Hey ORBIT, can you look at my screen and tell me what's wrong?"), { question: "tell me what's wrong?", preset: "general" });
  assert.deepEqual(parseLookRequest("look at my screen: what's wrong in this Roblox error?"), { question: "what's wrong in this Roblox error?", preset: "roblox" });
  assert.equal(parseLookRequest("what should I look at on my screen layout"), null);
  assert.equal(parseLookRequest("I can't look at my screenplay"), null);
  assert.equal(parseLookRequest("screen time today?"), null);
});

test("lookPrompt: default question, Roblox preset asks for quoted errors", () => {
  assert.match(lookPrompt("  ", "general"), /what do you see/);
  assert.equal(lookPrompt("why is it red?", "general"), "why is it red?");
  const r = lookPrompt("why?", "roblox");
  assert.match(r, /Roblox Studio/);
  assert.match(r, /"Error: "/);
  assert.match(r, /My question: why\?$/);
  assert.ok(lookPrompt("x".repeat(9000), "general").length <= 2000);
});

test("robloxErrors: picks quoted Error lines, deduped, max 3, skips 'none'", () => {
  const a = [
    "Here is what I see:",
    "Error: ServerScriptService.Main:12: attempt to index nil with 'Parent'",
    "- **Error:** `Workspace.Door.Script:4: Touched is not a valid member of Model \"Door\"`",
    "Error: ServerScriptService.Main:12: attempt to index nil with 'Parent'",
    "Error: Infinite yield possible on 'ReplicatedStorage:WaitForChild(\"Remotes\")'",
    "Error: fourth",
    "The error happens because…",
  ].join("\n");
  assert.deepEqual(robloxErrors(a), [
    "ServerScriptService.Main:12: attempt to index nil with 'Parent'",
    "Workspace.Door.Script:4: Touched is not a valid member of Model \"Door\"",
    "Infinite yield possible on 'ReplicatedStorage:WaitForChild(\"Remotes\")'",
  ]);
  assert.deepEqual(robloxErrors("Error: none visible in the Output window."), []);
  assert.deepEqual(robloxErrors("All good."), []);
});
