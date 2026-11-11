import { test } from "node:test";
import assert from "node:assert/strict";
import { maxSteps, fallbackNote, describeFailure } from "../src/lib/core-capability-pure.ts";
import { speechChunks, sentenceStream } from "../src/components/voice/speech-text.ts";

test("maxSteps: default 8, operator turns 16, clamped 2..20", () => {
  assert.equal(maxSteps(undefined), 8);
  assert.equal(maxSteps("abc"), 8);
  assert.equal(maxSteps("1"), 2);
  assert.equal(maxSteps("50"), 20);
  assert.equal(maxSteps(undefined, true), 16);
  assert.equal(maxSteps("4", true), 16);
  assert.equal(maxSteps("50", true), 20);
  assert.equal(maxSteps("6"), 6);
});

test("fallbackNote surfaces deep → main only", () => {
  assert.equal(fallbackNote([{ step: "think", detail: "x" }]), "");
  assert.equal(fallbackNote([{ step: "fallback", detail: "--effort not supported" }]), "");
  assert.match(fallbackNote([{ step: "fallback", detail: "deep → main model (time limit)" }]), /without the deep model \(time limit\)/);
});

test("describeFailure names limit, login, timeout", () => {
  assert.match(describeFailure("Claude AI usage limit reached, resets 5pm"), /usage limit.*resets 5pm/);
  assert.match(describeFailure("Invalid API key · Please run /login"), /login expired/);
  assert.match(describeFailure("OAuth token has expired"), /login expired/);
  assert.match(describeFailure("Claude Code timed out after 2 minutes"), /did not finish/);
  assert.equal(describeFailure("boom"), "boom");
});

test("voice summary: only the first paragraph is spoken, full text stays", () => {
  const md = "Here is the plan in short. Three steps today.\n\n## Details\n- step one\n- step two";
  assert.deepEqual(speechChunks(md, true), ["Here is the plan in short.", "Three steps today."]);
  assert.ok(speechChunks(md).length > 2);
  const s = sentenceStream(true);
  const out = [...s.push("Short answer. "), ...s.push("Done.\n"), ...s.push("\nLong part. More."), ...s.flush()];
  assert.deepEqual(out, ["Short answer.", "Done."]);
});

test("voice summary: a leading heading does not end the summary", () => {
  assert.deepEqual(speechChunks("## Plan\n\nDo A first. Then B.\n\nDetail.", true), ["Plan.", "Do A first.", "Then B."]);
});

import { sessionInput } from "../src/lib/core-capability-pure.ts";
import { selectModules, MODULE_HINTS } from "../src/lib/core-modules-pure.ts";

test("sessionInput: full, history-less, or nothing", () => {
  const t = "User: hi\nCORE: hey";
  const p = `NOW: x\n\nCONVERSATION SO FAR:\n${t}\n\nUSER: next`;
  assert.equal(sessionInput(p, t, false, false), p);
  assert.equal(sessionInput(p, t, true, false), "NOW: x\n\nUSER: next");
  assert.equal(sessionInput(p, t, true, true), "");
  assert.equal(sessionInput(p, "", true, false), p);
});

test("fallbackNote: session fallback is visible", () => {
  assert.match(fallbackNote([{ step: "fallback", detail: "session → stateless (No conversation found)" }]), /session failed.*No conversation found/);
});

test("selectModules loads only what the request needs", () => {
  const mods = ["STUDIO", "LIFE", "DEALS", "WEEK", "NOHINT", "IDEAS"].map((name) => ({ name, prompt: name, tools: [] }));
  const names = (t: string) => selectModules(mods, t).map((m) => m.name);
  assert.deepEqual(names("remind me at 6 to call mom"), ["LIFE", "NOHINT"]);
  assert.deepEqual(names("I want a used RTX 4070 under 400€"), ["DEALS", "NOHINT"]);
  assert.deepEqual(names("what slipped this week"), ["WEEK", "NOHINT"]);
  assert.deepEqual(names("explain quantum tunnelling"), ["NOHINT"]); // no hint: always loads
  assert.ok(names("schedule the approved clips").includes("STUDIO"));
  assert.ok(Object.keys(MODULE_HINTS).length >= 10);
});
