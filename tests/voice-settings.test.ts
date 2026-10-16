import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VOICE, migrateVoiceSettings, recognizerFor } from "../src/components/voice/bus.ts";

test("migrateVoiceSettings maps the old wake/engine pair to hands-free modes", () => {
  assert.equal(migrateVoiceSettings({ wake: true, engine: "chrome" }).handsFree, "chrome");
  assert.equal(migrateVoiceSettings({ wake: true, engine: "whisper" }).handsFree, "local"); // chose Whisper = wanted audio local
  assert.equal(migrateVoiceSettings({ wake: false, engine: "whisper" }).handsFree, "off");
  const m = migrateVoiceSettings({ speak: false, wake: true, voiceURI: "v1", rate: 1.2, lang: "et-EE", engine: "whisper" });
  assert.deepEqual(m, { speak: false, handsFree: "local", voiceURI: "v1", rate: 1.2, lang: "et-EE", engine: "whisper" });
  assert.equal("wake" in m, false);
});

test("migrateVoiceSettings keeps new settings and repairs junk", () => {
  assert.deepEqual(migrateVoiceSettings({}), DEFAULT_VOICE);
  assert.deepEqual(migrateVoiceSettings(null), DEFAULT_VOICE);
  assert.equal(migrateVoiceSettings({ handsFree: "off", wake: true }).handsFree, "off"); // new field wins
  assert.equal(migrateVoiceSettings({ handsFree: "local" }).handsFree, "local");
  const j = migrateVoiceSettings({ handsFree: "cloud", engine: "x", rate: "fast", lang: "", voiceURI: 3 });
  assert.deepEqual(j, DEFAULT_VOICE);
});

test("Local only never constructs a Chrome recognizer, for hands-free or push-to-talk", () => {
  for (const engine of ["chrome", "whisper"] as const) {
    assert.equal(recognizerFor({ handsFree: "local", engine }, "handsFree"), "whisper");
    assert.equal(recognizerFor({ handsFree: "local", engine }, "pushToTalk"), "whisper");
  }
});

test("recognizerFor keeps Chrome and Off behaviour", () => {
  assert.equal(recognizerFor({ handsFree: "off", engine: "chrome" }, "handsFree"), null);
  assert.equal(recognizerFor({ handsFree: "chrome", engine: "chrome" }, "handsFree"), "chrome");
  assert.equal(recognizerFor({ handsFree: "chrome", engine: "whisper" }, "handsFree"), "chrome");
  assert.equal(recognizerFor({ handsFree: "chrome", engine: "chrome" }, "pushToTalk"), "chrome");
  assert.equal(recognizerFor({ handsFree: "off", engine: "whisper" }, "pushToTalk"), "whisper");
});
