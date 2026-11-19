import { test } from "node:test";
import assert from "node:assert/strict";
import { parakeetText, voiceEngine } from "../src/lib/voice-asr-pure.ts";

test("Parakeet by default, Whisper when asked or when Parakeet failed", () => {
  assert.equal(voiceEngine(undefined, false), "parakeet");
  assert.equal(voiceEngine("parakeet", false), "parakeet");
  assert.equal(voiceEngine(" Whisper ", false), "whisper");
  assert.equal(voiceEngine(undefined, true), "whisper");
});

test("a sherpa result becomes plain text", () => {
  assert.equal(parakeetText({ text: "  Hello   world. " }), "Hello world.");
  assert.equal(parakeetText({ tokens: [" Tere", " maailm", "."] }), "Tere maailm.");
  assert.equal(parakeetText(undefined), "");
});
