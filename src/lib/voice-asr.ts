import path from "node:path";
import { studioRoot } from "./clips/factory";

// Voice input's Whisper: an English-only model (more accurate on accented English than the clip factory's multilingual
// base). Same transformers.js runtime and model cache folder as the clip factory.
const MODEL = process.env.ORBIT_VOICE_WHISPER_MODEL || "Xenova/whisper-small.en";

type Asr = (audio: Float32Array, o?: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
// On globalThis so dev hot reloads keep one loaded model.
const g = globalThis as unknown as { __orbitVoiceAsr?: Promise<Asr> };

export function loadVoiceAsr(): Promise<Asr> {
  g.__orbitVoiceAsr ??= (async () => {
    const tf = await import("@huggingface/transformers");
    tf.env.cacheDir = path.join(studioRoot(), "models");
    // fp32 encoder for accuracy, 8-bit decoder for speed (the decoder runs once per token).
    return (await tf.pipeline("automatic-speech-recognition", MODEL, { dtype: { encoder_model: "fp32", decoder_model_merged: "q8" } })) as unknown as Asr;
  })();
  g.__orbitVoiceAsr.catch(() => { g.__orbitVoiceAsr = undefined; }); // let the next request retry a failed download
  return g.__orbitVoiceAsr;
}

export async function transcribeSpeech(audio: Float32Array): Promise<string> {
  const out = await (await loadVoiceAsr())(audio);
  return (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
}
