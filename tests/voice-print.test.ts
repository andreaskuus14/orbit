import { test } from "node:test";
import assert from "node:assert/strict";
import { bandEnvelope, cosine, matchScore, matchThreshold, pitchHz, summarize, type Frame } from "../src/components/voice/voiceprint.ts";

const sine = (hz: number, rate: number, n: number, harmonics = 1) =>
  Float32Array.from({ length: n }, (_, i) => Array.from({ length: harmonics }, (_, h) => Math.sin(2 * Math.PI * hz * (h + 1) * i / rate) / (h + 1)).reduce((a, v) => a + v, 0));

test("cosine similarity", () => {
  assert.equal(cosine([1, 2, 3], [2, 4, 6]).toFixed(6), "1.000000");
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 1]), 0); // silence: no direction
});

test("pitch from a synthetic tone, including harmonics (no octave error)", () => {
  for (const [hz, rate] of [[220, 16000], [110, 48000], [180, 44100], [320, 48000]] as const) {
    const p = pitchHz(sine(hz, rate, 1024, 4), rate);
    assert.ok(p !== null && Math.abs(p - hz) / hz < 0.02, `${hz} Hz @ ${rate}: got ${p}`);
  }
  assert.equal(pitchHz(new Float32Array(1024), 16000), null); // silence
  let seed = 1;
  const noise = Float32Array.from({ length: 1024 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5);
  assert.equal(pitchHz(noise, 16000), null); // unvoiced
});

test("band envelope ignores loudness", () => {
  const db = Float32Array.from({ length: 1024 }, (_, i) => -30 - i / 20);
  const louder = db.map((v) => v + 12);
  assert.deepEqual(bandEnvelope(db, 48000).map((v) => v.toFixed(6)), bandEnvelope(louder, 48000).map((v) => v.toFixed(6)));
  assert.equal(bandEnvelope(Float32Array.from({ length: 1024 }, () => -Infinity), 48000).every((v) => v === 0), true);
});

test("summary, match score and threshold", () => {
  const env = Array.from({ length: 20 }, (_, i) => Math.sin(i / 3));
  const frames: Frame[] = Array.from({ length: 10 }, (_, i) => ({ t: i, env, pitch: 100 + i }));
  const me = summarize(frames)!;
  assert.equal(me.pitch, 105); // median
  assert.equal(summarize(frames.slice(0, 3)), null); // too little speech to judge
  assert.equal(matchScore(me, me).toFixed(6), "1.000000");
  const tv = { env: env.map((v) => -v), pitch: 210 }; // other shape, an octave up
  assert.equal(matchScore(me, tv), 0);
  assert.ok(matchScore(me, { env, pitch: 210 }) < matchThreshold(0.5)); // same shape, an octave off: fails at the default setting
  assert.ok(matchThreshold(1) > matchThreshold(0.5));
});
