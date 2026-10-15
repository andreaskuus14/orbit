"use client";
// Local Whisper voice input: record one utterance in the browser (16 kHz mono, in memory only) and have the ORBIT
// server transcribe it (/api/voice/transcribe). Nothing is stored.
import { voiceLevel } from "./bus";
import { ASR_RATE, concat, downsample, MAX_AUDIO_SEC, rms, VAD_START, vadStep } from "@/lib/audio-pure";
import { cleanWhisperText } from "./hear";

/** Record until ~1 s of silence after speech, stop() (via onStop), or 30 s. Resolves null when no speech was heard. */
export async function recordUtterance(signal: AbortSignal, onStop: (stop: () => void) => void): Promise<Float32Array | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const ctx = new AudioContext();
  const chunks: Float32Array[] = [];
  let vad = VAD_START, manual = false;
  try {
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1); // shortcut: deprecated but simplest; move to an AudioWorklet if Chrome removes it
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      onStop(() => { manual = true; resolve(); });
      proc.onaudioprocess = (e) => {
        const frame = new Float32Array(e.inputBuffer.getChannelData(0)); // copy: the browser reuses this buffer
        chunks.push(frame);
        const level = rms(frame);
        voiceLevel.mic = Math.min(1, level * 5); // normal speech RMS ≈ 0.05–0.2; drives the mic's pulse ring
        vad = vadStep(vad, level, (frame.length / ctx.sampleRate) * 1000);
        if (vad.done) resolve();
      };
      src.connect(proc);
      proc.connect(ctx.destination); // a ScriptProcessor only runs while connected; it outputs silence
    });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    voiceLevel.mic = 0;
  }
  const audio = downsample(concat(chunks), ctx.sampleRate).slice(0, MAX_AUDIO_SEC * ASR_RATE);
  // Released by hand: send it unless it's under half a second (the VAD may miss very soft speech).
  return vad.speech || (manual && audio.length > ASR_RATE / 2) ? audio : null;
}

export async function transcribeAudio(audio: Float32Array, signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/voice/transcribe", {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: audio.buffer as ArrayBuffer, signal,
  });
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
  return cleanWhisperText(json.text ?? "");
}
