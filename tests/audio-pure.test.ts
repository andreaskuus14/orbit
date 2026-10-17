import { test } from "node:test";
import assert from "node:assert/strict";
import { ASR_RATE, concat, decodeAudioBody, downsample, MAX_AUDIO_BYTES, rms, VAD_START, vadStep, type Vad } from "../src/lib/audio-pure.ts";

const bytes = (f: Float32Array) => new Uint8Array(f.buffer.slice(0));

function wav(samples: number, o: { rate?: number; channels?: number; format?: number; bits?: number } = {}) {
  const { rate = ASR_RATE, channels = 1, format = 1, bits = 16 } = o;
  const dataLen = samples * (bits / 8), b = new Uint8Array(44 + dataLen), dv = new DataView(b.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => { b[at + i] = c.charCodeAt(0); });
  put(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); put(8, "WAVE");
  put(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, format, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * channels * bits / 8, true); dv.setUint16(32, channels * bits / 8, true); dv.setUint16(34, bits, true);
  put(36, "data"); dv.setUint32(40, dataLen, true);
  for (let i = 0; i < samples; i++) if (bits === 16) dv.setInt16(44 + i * 2, i % 2 ? 16384 : -16384, true); else if (bits === 32) dv.setFloat32(44 + i * 4, 0.25, true);
  return b;
}

test("decodeAudioBody reads raw Float32 and validates length", () => {
  const ok = decodeAudioBody(bytes(new Float32Array(ASR_RATE).fill(0.5)));
  assert.ok("audio" in ok && ok.audio.length === ASR_RATE && ok.audio[0] === 0.5);
  assert.match((decodeAudioBody(bytes(new Float32Array(100))) as { error: string }).error, /short/);
  assert.match((decodeAudioBody(bytes(new Float32Array(ASR_RATE * 31))) as { error: string }).error, /long/);
  assert.match((decodeAudioBody(new Uint8Array(MAX_AUDIO_BYTES + 4)) as { error: string }).error, /long/);
  assert.match((decodeAudioBody(new Uint8Array(ASR_RATE * 4 + 2)) as { error: string }).error, /WAV or raw/);
  assert.match((decodeAudioBody(bytes(new Float32Array(ASR_RATE).fill(NaN))) as { error: string }).error, /invalid/);
});

test("decodeAudioBody reads 16 kHz mono WAV (PCM16 and float) and rejects other formats", () => {
  const pcm = decodeAudioBody(wav(ASR_RATE));
  assert.ok("audio" in pcm && pcm.audio.length === ASR_RATE && pcm.audio[0] === -0.5 && pcm.audio[1] === 0.5);
  const fl = decodeAudioBody(wav(ASR_RATE, { format: 3, bits: 32 }));
  assert.ok("audio" in fl && fl.audio[0] === 0.25);
  assert.match((decodeAudioBody(wav(ASR_RATE, { rate: 44100 })) as { error: string }).error, /16 kHz mono/);
  assert.match((decodeAudioBody(wav(ASR_RATE, { channels: 2 })) as { error: string }).error, /16 kHz mono/);
  assert.match((decodeAudioBody(wav(ASR_RATE, { bits: 8 })) as { error: string }).error, /16-bit/);
  assert.match((decodeAudioBody(wav(10).slice(0, 30)) as { error: string }).error, /Malformed/);
});

test("rms, concat and downsample", () => {
  assert.equal(rms(new Float32Array([0.5, -0.5])), 0.5);
  assert.equal(rms(new Float32Array(0)), 0);
  assert.deepEqual([...concat([new Float32Array([1]), new Float32Array([2, 3])])], [1, 2, 3]);
  const d = downsample(new Float32Array(48000).fill(0.3), 48000);
  assert.equal(d.length, 16000);
  assert.ok(Math.abs(d[100] - 0.3) < 1e-6);
  assert.equal(downsample(new Float32Array(44100), 44100).length, 16000);
  const same = new Float32Array([1, 2]);
  assert.notEqual(downsample(same, 16000), same);
});

test("vadStep ends after speech then ~1 s of silence, or with no speech at all", () => {
  const run = (levels: number[], frameMs = 100) => { let v: Vad = VAD_START; for (const l of levels) { v = vadStep(v, l, frameMs); if (v.done) break; } return v; };
  const quiet = Array(5).fill(0.002), talk = Array(10).fill(0.1);
  const a = run([...quiet, ...talk, ...Array(9).fill(0.002)]);
  assert.equal(a.speech, true); assert.equal(a.done, false); // 0.9 s of silence: still waiting
  const b = run([...quiet, ...talk, ...Array(10).fill(0.002)]);
  assert.equal(b.done, true);
  const c = run([...quiet, 0.2, ...Array(100).fill(0.002)]); // one click is not speech
  assert.equal(c.speech, false); assert.equal(c.done, true); assert.equal(c.ms, 8000);
  const d = run(Array(400).fill(0.1)); // nonstop talking stops at the 30 s cap
  assert.equal(d.done, true); assert.equal(d.ms, 30000);
});

test("ORBIT mic VAD: onset needs 120 ms, hangover holds through short pauses, ends after 600 ms quiet; hiss isn't speech", async () => {
  const { MIC_START, micStep, zcr } = await import("../src/lib/audio-pure.ts");
  const run = (frames: [number, number][], frameMs = 40) => {
    let m = MIC_START; const events: string[] = [];
    for (const [level, z] of frames) { const r = micStep(m, level, z, frameMs); m = r.m; if (r.event) events.push(r.event); }
    return { m, events };
  };
  const quiet = (n: number) => Array(n).fill([0.002, 0.05]) as [number, number][];
  const talk = (n: number) => Array(n).fill([0.1, 0.05]) as [number, number][];
  assert.deepEqual(run([...quiet(5), ...talk(2), ...quiet(20)]).events, []); // 80 ms: a click
  assert.deepEqual(run([...quiet(5), ...talk(10), ...quiet(14)]).events, ["start"]); // 560 ms quiet: still in the turn
  assert.deepEqual(run([...quiet(5), ...talk(10), ...quiet(10), ...talk(5), ...quiet(15)]).events, ["start", "end"]); // pause bridged
  assert.deepEqual(run([...quiet(5), ...(Array(20).fill([0.1, 0.6]) as [number, number][])]).events, []); // loud hiss: high ZCR
  const r = run([...quiet(5), ...talk(10)]);
  assert.equal(r.m.speechMs, 400);
  assert.equal(zcr(new Float32Array([1, -1, 1, -1, 1])), 1);
  assert.equal(zcr(new Float32Array([0.1, 0.2, 0.3])), 0);
});

test("encodeWav writes 16 kHz mono PCM16 that decodeAudioBody reads back", async () => {
  const { encodeWav } = await import("../src/lib/audio-pure.ts");
  const x = Float32Array.from({ length: ASR_RATE }, (_, i) => Math.sin(i / 10) * 0.5);
  x[0] = 2; x[1] = NaN; // clipped / junk samples stay valid
  const w = encodeWav(x);
  assert.equal(w.length, 44 + ASR_RATE * 2);
  const d = decodeAudioBody(w);
  assert.ok("audio" in d);
  assert.equal(d.audio.length, ASR_RATE);
  assert.ok(Math.abs(d.audio[0] - 1) < 1e-3 && d.audio[1] === 0);
  for (let i = 2; i < x.length; i += 997) assert.ok(Math.abs(d.audio[i] - x[i]) < 1e-4, `sample ${i}`);
});
