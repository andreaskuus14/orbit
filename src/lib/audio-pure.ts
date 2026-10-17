// Pure audio helpers for local Whisper voice input: capture side (RMS, downsample, a simple VAD) and the server's
// body parsing (raw Float32 LE or WAV, 16 kHz mono, ≤ 30 s). No DOM, no Node APIs — tested in tests/audio-pure.test.ts.
export const ASR_RATE = 16000;
export const MAX_AUDIO_SEC = 30;
export const MAX_AUDIO_BYTES = MAX_AUDIO_SEC * ASR_RATE * 4 + 1024; // Float32 samples + room for a WAV header

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Resample to `to` Hz by averaging each output sample's input span (a box filter: cheap anti-aliasing). Always a new array. */
export function downsample(x: Float32Array, from: number, to = ASR_RATE): Float32Array {
  if (from <= to) return Float32Array.from(x); // shortcut: no upsampling; mic contexts run at 44.1/48 kHz
  const ratio = from / to, out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    out[i] = b > a ? s / (b - a) : 0;
  }
  return out;
}

/** Voice activity: noise floor that drops instantly and rises slowly with steady noise; a frame is speech when well above it. */
export type Vad = { ms: number; speechMs: number; silenceMs: number; floor: number; speech: boolean; done: boolean };
export const VAD_START: Vad = { ms: 0, speechMs: 0, silenceMs: 0, floor: 0.02, speech: false, done: false };
export function vadStep(v: Vad, level: number, frameMs: number, o = { silenceMs: 1000, maxMs: MAX_AUDIO_SEC * 1000, noSpeechMs: 8000 }): Vad {
  const loud = level > Math.max(0.012, v.floor * 3);
  // Digital-silence frames (Chrome's first buffer) mustn't pin the floor at 0, or steady room noise reads as endless speech.
  const floor = level < 1e-4 ? v.floor : Math.max(0.004, level < v.floor ? level : v.floor + (level - v.floor) * (loud ? 0 : 0.05));
  const ms = v.ms + frameMs, speechMs = v.speechMs + (loud ? frameMs : 0), silenceMs = loud ? 0 : v.silenceMs + frameMs;
  const speech = speechMs >= 150; // not a click or a breath
  const done = ms >= o.maxMs || (speech && silenceMs >= o.silenceMs) || (!speech && ms >= o.noSpeechMs);
  return { ms, speechMs, silenceMs, floor, speech, done };
}

/** Zero crossings per sample (0..1). Voiced speech is low; hiss and fan noise are high. */
export function zcr(x: Float32Array): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] >= 0) !== (x[i] >= 0)) n++;
  return x.length > 1 ? n / (x.length - 1) : 0;
}

/** ORBIT mic's always-on VAD: energy over an adaptive noise floor plus a zero-crossing check, an onset (120 ms of loud
 *  frames, so clicks don't count) and a hangover (endMs of quiet before the segment ends). speechMs: loud time in this segment. */
export type Mic = { floor: number; speaking: boolean; loudMs: number; quietMs: number; speechMs: number };
export const MIC_START: Mic = { floor: 0.02, speaking: false, loudMs: 0, quietMs: 0, speechMs: 0 };
export const MIC_ONSET_MS = 120, MIC_END_MS = 600;
export function micStep(m: Mic, level: number, crossings: number, frameMs: number, endMs = MIC_END_MS): { m: Mic; event: "start" | "end" | null } {
  const loud = level > Math.max(0.012, m.floor * 3) && crossings < 0.3;
  const floor = level < 1e-4 ? m.floor : Math.max(0.004, level < m.floor ? level : m.floor + (level - m.floor) * (loud ? 0 : 0.05));
  if (!m.speaking) {
    const loudMs = loud ? m.loudMs + frameMs : Math.max(0, m.loudMs - frameMs);
    return loudMs >= MIC_ONSET_MS ? { m: { floor, speaking: true, loudMs, quietMs: 0, speechMs: loudMs }, event: "start" } : { m: { ...m, floor, loudMs }, event: null };
  }
  const quietMs = loud ? 0 : m.quietMs + frameMs, speechMs = m.speechMs + (loud ? frameMs : 0);
  return quietMs >= endMs ? { m: { floor, speaking: false, loudMs: 0, quietMs: 0, speechMs: 0 }, event: "end" } : { m: { ...m, floor, quietMs, speechMs }, event: null };
}

/** 16 kHz mono samples → 16-bit PCM WAV (half the bytes of raw Float32; decodeAudioBody reads it back). */
export function encodeWav(x: Float32Array, rate = ASR_RATE): Uint8Array {
  const b = new Uint8Array(44 + x.length * 2), dv = new DataView(b.buffer);
  const put = (at: number, t: string) => { for (let i = 0; i < 4; i++) b[at + i] = t.charCodeAt(i); };
  put(0, "RIFF"); dv.setUint32(4, 36 + x.length * 2, true); put(8, "WAVE"); put(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); put(36, "data"); dv.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i] || 0)) * 32767), true);
  return b;
}

/** Request body → 16 kHz mono samples, or an error message. Accepts a WAV (PCM16 or Float32) or raw little-endian Float32. */
export function decodeAudioBody(b: Uint8Array): { audio: Float32Array } | { error: string } {
  if (b.length > MAX_AUDIO_BYTES) return { error: `Audio too long (max ${MAX_AUDIO_SEC} s)` };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  let audio: Float32Array;
  if (b.length >= 12 && tag(0) === "RIFF" && tag(8) === "WAVE") {
    let fmt: { format: number; channels: number; rate: number; bits: number } | null = null, data: [number, number] | null = null;
    for (let o = 12; o + 8 <= b.length;) {
      const id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
      if (id === "fmt " && size >= 16 && body + 16 <= b.length) fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      if (id === "data") { data = [body, Math.min(size, b.length - body)]; break; }
      o = body + size + (size & 1);
    }
    if (!fmt || !data) return { error: "Malformed WAV" };
    if (fmt.channels !== 1 || fmt.rate !== ASR_RATE) return { error: "WAV must be 16 kHz mono" };
    const [at, len] = data;
    if (fmt.format === 1 && fmt.bits === 16) {
      audio = new Float32Array(len >> 1);
      for (let i = 0; i < audio.length; i++) audio[i] = dv.getInt16(at + i * 2, true) / 32768;
    } else if (fmt.format === 3 && fmt.bits === 32) {
      audio = new Float32Array(len >> 2);
      for (let i = 0; i < audio.length; i++) audio[i] = dv.getFloat32(at + i * 4, true);
    } else return { error: "WAV must be 16-bit PCM or 32-bit float" };
  } else {
    if (b.length % 4) return { error: "Body must be a WAV or raw Float32 samples" };
    audio = new Float32Array(b.length / 4);
    for (let i = 0; i < audio.length; i++) audio[i] = dv.getFloat32(i * 4, true);
  }
  if (audio.length < ASR_RATE / 10) return { error: "Audio too short" };
  if (audio.length > MAX_AUDIO_SEC * ASR_RATE) return { error: `Audio too long (max ${MAX_AUDIO_SEC} s)` };
  for (let i = 0; i < audio.length; i++) if (!Number.isFinite(audio[i])) return { error: "Audio contains invalid samples" };
  return { audio };
}
