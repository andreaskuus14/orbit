"use client";
// Local Whisper voice input: record one utterance in the browser (16 kHz mono, in memory only) and have the ORBIT
// server transcribe it (/api/voice/transcribe). Nothing is stored.
import { voiceLevel } from "./bus";
import { ASR_RATE, concat, downsample, MAX_AUDIO_SEC, rms, VAD_START, vadStep } from "@/lib/audio-pure";
import { cleanWhisperText } from "./hear";

/** Hands-free local listening: wait for speech indefinitely (keeping only a short pre-roll), cap the utterance at
 *  maxSec, and skip anything with less than minSpeechSec of speech so room noise never reaches Whisper. */
export type IdleListen = { maxSec: number; minSpeechSec: number };
const PREROLL_SEC = 0.5;

/** Record until ~1 s of silence after speech, stop() (via onStop), or 30 s. Resolves null when no speech was heard.
 *  With `idle`, waits for speech instead of giving up after 8 s and leaves the mic level meter alone. */
export async function recordUtterance(signal: AbortSignal, onStop: (stop: () => void) => void, idle?: IdleListen): Promise<Float32Array | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  let ctx: AudioContext | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const chunks: Float32Array[] = [];
  let vad = VAD_START, manual = false, rate = 48000;
  try {
    ctx = new AudioContext();
    rate = ctx.sampleRate;
    await ctx.resume().catch(() => {}); // created without a click (wake word): may start suspended
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1); // shortcut: deprecated but simplest; move to an AudioWorklet if Chrome removes it
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      onStop(() => { manual = true; resolve(); });
      timer = setTimeout(resolve, (idle ? 60 : MAX_AUDIO_SEC + 1) * 1000); // wall clock: frames stop if the context stalls or the mic drops
      const track = stream.getAudioTracks()[0];
      if (track) track.onended = () => resolve();
      proc.onaudioprocess = (e) => {
        const frame = new Float32Array(e.inputBuffer.getChannelData(0)); // copy: the browser reuses this buffer
        chunks.push(frame);
        const level = rms(frame), frameMs = (frame.length / rate) * 1000;
        if (!idle) voiceLevel.mic = Math.min(1, level * 5); // normal speech RMS ≈ 0.05–0.2; drives the mic's pulse ring
        vad = idle ? vadStep(vad, level, frameMs, { silenceMs: 800, maxMs: idle.maxSec * 1000, noSpeechMs: Infinity }) : vadStep(vad, level, frameMs);
        if (idle && !vad.speech && vad.silenceMs >= 1000) { // only quiet (or a click) so far: forget it, keep a pre-roll, restart the clock
          chunks.splice(0, Math.max(0, chunks.length - Math.ceil((PREROLL_SEC * 1000) / frameMs)));
          vad = { ...VAD_START, floor: vad.floor };
        }
        if (vad.done) resolve();
      };
      src.connect(proc);
      proc.connect(ctx!.destination); // a ScriptProcessor only runs while connected; it outputs silence
    });
  } finally {
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    if (!idle) voiceLevel.mic = 0;
  }
  if (idle) return vad.speech && vad.speechMs >= idle.minSpeechSec * 1000 ? downsample(concat(chunks), rate).slice(0, idle.maxSec * ASR_RATE) : null;
  const audio = downsample(concat(chunks), rate).slice(0, MAX_AUDIO_SEC * ASR_RATE);
  // Released by hand: send it unless it's under half a second (the VAD may miss very soft speech).
  return vad.speech || (manual && audio.length > ASR_RATE / 2) ? audio : null;
}

export async function transcribeAudio(audio: Float32Array, signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/voice/transcribe", {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: audio.buffer as ArrayBuffer, signal,
  });
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw Object.assign(new Error(json.error || `Transcription failed (${res.status})`), { status: res.status }); // 503 = model not ready
  return cleanWhisperText(json.text ?? "");
}
