import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMUNICATION_MAX, COMMUNICATION_STORED_MAX, briefCommand, briefProblems, briefReply, communicationText, isBrief, withBrief } from "../src/lib/brief-mode-pure.ts";

test("the marker switches on and off and keeps the owner's own words", () => {
  assert.equal(isBrief(""), false);
  const on = withBrief("Use metric units.", true);
  assert.equal(on, "[brief] Use metric units.");
  assert.ok(isBrief(on));
  assert.equal(withBrief(on, true), on, "idempotent");
  assert.equal(withBrief(on, false), "Use metric units.");
  assert.equal(communicationText(on), "Use metric units.");
  assert.equal(withBrief("", true), "[brief]");
});

test("the checker flags filler openers and unnumbered multi-step answers", () => {
  assert.deepEqual(briefProblems("Run npm test, then open the PR."), []);
  assert.deepEqual(briefProblems("1. Open Profile\n2. Turn on Brief\n3. Save"), []);
  assert.deepEqual(briefProblems("Great question! You can do it."), ["starts with filler"]);
  assert.deepEqual(briefProblems("- open it\n- click save\n- reload"), ["3+ steps not numbered"]);
  assert.deepEqual(briefProblems("First open it, then save, next reload, finally check."), ["3+ steps not numbered"]);
});

test("briefCommand: the whole message switches brief mode, anything longer is a normal question", () => {
  for (const s of ["be brief", "Be brief.", "CORE, be brief", "brief mode on", "Lühidalt!", "ole lühike"]) assert.equal(briefCommand(s)?.on, true, s);
  for (const s of ["normal", "Normal mode", "brief mode off", "tavaline"]) assert.equal(briefCommand(s)?.on, false, s);
  for (const s of ["be brief about the plan", "is that normal?", "what is brief mode", "normal distribution", ""]) assert.equal(briefCommand(s), null, s);
  assert.equal(briefCommand("lühidalt")?.et, true);
  assert.equal(briefCommand("be brief")?.et, false);
  assert.match(briefReply(true, false), /on/);
  assert.match(briefReply(false, true), /väljas/);
});

test("a bare 'normal' / 'tavaline' answers CORE's own question instead of switching brief mode off", () => {
  const asked = ["Which one do you mean: normal or brief?", "Want the long version?\n\nChoices: normal | brief", "Kumba sa mõtled, tavalist või lühikest?"];
  for (const prev of asked) for (const s of ["normal", "Normal.", "tavaline", "CORE, normal"]) assert.equal(briefCommand(s, prev), null, `${s} after "${prev}"`);
  assert.equal(briefCommand("normal", "Done. I saved it.")?.on, false);
  assert.equal(briefCommand("normal", "")?.on, false);
  assert.equal(briefCommand("tavaline", undefined)?.on, false);
  for (const s of ["brief mode off", "normal mode", "tavarežiim", "lühirežiim välja"]) assert.equal(briefCommand(s, "Which one?")?.on, false, `${s}: explicit commands still work`);
  assert.equal(briefCommand("be brief", "Which one?")?.on, true);
});

test("switching brief mode on never cuts the owner's text: the stored limit leaves room for the marker", () => {
  const own = "x".repeat(COMMUNICATION_MAX);
  const on = withBrief(own, true);
  assert.ok(on.length <= COMMUNICATION_STORED_MAX);
  assert.equal(communicationText(on), own);
  assert.equal(withBrief(on, false), own);
  assert.match(readFileSync(new URL("../src/lib/core.ts", import.meta.url), "utf8").match(/async function briefTurn[\s\S]*?\n}\n/)![0], /withBrief\(String\(data\?\.communication \?\? ""\), on\) }\)/, "no slice after withBrief");
});
