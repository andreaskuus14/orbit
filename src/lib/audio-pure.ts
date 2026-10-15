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
  const floor = level < v.floor ? level : loud ? v.floor : v.floor + (level - v.floor) * 0.05; // speech never raises the floor
  const ms = v.ms + frameMs, speechMs = v.speechMs + (loud ? frameMs : 0), silenceMs = loud ? 0 : v.silenceMs + frameMs;
  const speech = speechMs >= 150; // not a click or a breath
  const done = ms >= o.maxMs || (speech && silenceMs >= o.silenceMs) || (!speech && ms >= o.noSpeechMs);
  return { ms, speechMs, silenceMs, floor, speech, done };
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
