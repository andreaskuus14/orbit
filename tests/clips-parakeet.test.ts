import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAKEET, tokensToWords, wantParakeet } from "../src/lib/clips/parakeet-pure.ts";
import { videoCodec } from "../src/lib/clips/encode-pure.ts";
import { renderArgs } from "../src/lib/clips/pure.ts";

// Real sherpa-onnx output for the model's en.wav test file (shortened).
const EN = { tokens: [" A", "sk", " not", " what", " co", "un", "tr", "y", ",", " a", "sk", "."],
  timestamps: [0, 0.24, 0.4, 0.64, 0.8, 0.96, 1.04, 1.12, 1.28, 1.44, 1.6, 1.68], durations: [0.24, 0.16, 0.24, 0.16, 0.16, 0.08, 0.08, 0.08, 0.16, 0.16, 0.08, 0.08] };

test("tokensToWords joins pieces into words and keeps punctuation on the word before", () => {
  const w = tokensToWords(EN);
  assert.deepEqual(w.map((x) => x.text), ["Ask", "not", "what", "country,", "ask."]);
  assert.equal(w[0].start, 0);
  assert.ok(Math.abs(w[0].end - 0.4) < 1e-9); // "sk" ends at 0.24 + 0.16
  assert.ok(Math.abs(w[3].end - 1.44) < 1e-9); // "," at 1.28 + 0.16
});

test("tokensToWords moves words onto the video clock and survives empty results", () => {
  assert.equal(tokensToWords(EN, 100)[1].start, 100.4);
  assert.deepEqual(tokensToWords({}), []);
  assert.deepEqual(tokensToWords({ tokens: [".", " hi"], timestamps: [0, 1], durations: [0.1, 0.2] }).map((w) => w.text), [".", "hi"]);
});

test("Parakeet is the default; ORBIT_ASR=whisper turns it off", () => {
  assert.equal(wantParakeet(undefined), true);
  assert.equal(wantParakeet(""), true);
  assert.equal(wantParakeet(" Whisper "), false);
  assert.match(PARAKEET.sha256, /^[0-9a-f]{64}$/);
  assert.equal(PARAKEET.license, "CC-BY-4.0");
});

test("renderArgs uses libx264 by default and h264_nvenc when asked", () => {
  const base = { input: "s.mp4", start: 0, duration: 5, out: "o.mp4" };
  const cpu = renderArgs(base), gpu = renderArgs({ ...base, encoder: "nvenc" });
  assert.equal(cpu[cpu.indexOf("-c:v") + 1], "libx264");
  assert.equal(gpu[gpu.indexOf("-c:v") + 1], "h264_nvenc");
  assert.ok(gpu.includes("yuv420p") && !gpu.includes("-crf"));
  assert.deepEqual(videoCodec("x264"), ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"]); // unchanged CPU output
});
