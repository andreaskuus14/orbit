import { test } from "node:test";
import assert from "node:assert/strict";
import { parakeetText, voiceEngine, voicePlan } from "../src/lib/voice-asr-pure.ts";

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

test("voicePlan: Whisper until Parakeet's model is on disk; the first use starts the download once, in the background", () => {
  const x = { env: undefined, failed: false, available: true, installed: false, downloading: false };
  assert.deepEqual(voicePlan(x), { engine: "whisper", download: true }, "first use: answer with Whisper, start the download");
  assert.deepEqual(voicePlan({ ...x, downloading: true }), { engine: "whisper", download: false }, "already downloading: don't start another");
  assert.deepEqual(voicePlan({ ...x, installed: true }), { engine: "parakeet", download: false });
  assert.deepEqual(voicePlan({ ...x, installed: true, failed: true }), { engine: "whisper", download: false }, "its child couldn't start: Whisper from now on");
  assert.deepEqual(voicePlan({ ...x, available: false }), { engine: "whisper", download: false }, "sherpa not installed: nothing to download for");
  assert.deepEqual(voicePlan({ ...x, env: "whisper", installed: true }), { engine: "whisper", download: false }, "ORBIT_ASR=whisper");
});
