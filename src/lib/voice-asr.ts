import path from "node:path";
import { studioRoot } from "./clips/factory";
import { asrPipeline } from "./asr-pool";

// Voice input's Whisper: an English-only model (more accurate on accented English than the clip factory's multilingual
// base). Same transformers.js runtime and model cache folder as the clip factory.
const MODEL = process.env.ORBIT_VOICE_WHISPER_MODEL || "Xenova/whisper-small.en";

type Asr = (audio: Float32Array, o?: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
// On globalThis so dev hot reloads keep one loaded model.
const g = globalThis as unknown as { __orbitVoiceAsr?: Promise<Asr>; __orbitVoiceQ?: Promise<unknown> };

export function loadVoiceAsr(): Promise<Asr> {
  // Own worker lane (asr-pool), so voice never waits behind clip transcription.
  // fp32 encoder for accuracy, 8-bit decoder for speed (the decoder runs once per token).
  g.__orbitVoiceAsr ??= asrPipeline("voice", MODEL, { dtype: { encoder_model: "fp32", decoder_model_merged: "q8" } }, path.join(studioRoot(), "models")) as Promise<Asr>;
  g.__orbitVoiceAsr.catch(() => { g.__orbitVoiceAsr = undefined; }); // let the next request retry a failed download
  return g.__orbitVoiceAsr;
}

/** One at a time: parallel runs would each grab every CPU core and all get slower. */
export function transcribeSpeech(audio: Float32Array): Promise<string> {
  const run = async () => {
    const asr = await loadVoiceAsr();
    const out = await asr(audio);
    return (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
  };
  const p = (g.__orbitVoiceQ ?? Promise.resolve()).then(run, run);
  g.__orbitVoiceQ = p.catch(() => {});
  return p;
}
