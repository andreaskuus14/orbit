import path from "node:path";
import { studioRoot } from "./clips/factory";
import { asrPipeline } from "./asr-pool";
import { parakeetText, voiceEngine } from "./voice-asr-pure";

// Voice input's Whisper: an English-only model (more accurate on accented English than the clip factory's multilingual
// base). Same transformers.js runtime and model cache folder as the clip factory.
const MODEL = process.env.ORBIT_VOICE_WHISPER_MODEL || "Xenova/whisper-small.en";
// Estonian / auto-detect: the multilingual sibling, loaded only the first time someone asks for it (another ~1 GB in RAM).
const MULTI = process.env.ORBIT_VOICE_WHISPER_MULTI_MODEL || "Xenova/whisper-small";
export type VoiceLang = "en" | "et" | "auto";

type Asr = (audio: Float32Array, o?: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
// On globalThis so dev hot reloads keep one loaded model.
const g = globalThis as unknown as { __orbitVoiceAsr?: Partial<Record<"en" | "multi" | "parakeet", Promise<Asr>>>; __orbitVoiceNoParakeet?: boolean; __orbitVoiceQ?: Promise<unknown>; __orbitVoiceN?: number };
export const MAX_VOICE_QUEUE = 4;
/** Transcriptions queued or running: past MAX_VOICE_QUEUE the route answers 429 instead of piling up stale audio. */
export const voiceQueue = () => g.__orbitVoiceN ?? 0;
export const parseVoiceLang = (q: string | null): VoiceLang => (q === "et" || q === "auto" ? q : "en");

// Parakeet TDT v3 (sherpa-onnx, in this process, the clip factory's shared cached recognizer): auto-detects the language, so `lang` is
// ignored. Short utterances decode in one go, no piece splitting. Whisper only when it can't load (or ORBIT_ASR=whisper).
const parakeetAsr = async (): Promise<Asr> => {
  const { loadParakeet } = await import("./clips/parakeet");
  const rec = await loadParakeet(path.join(studioRoot(), "models"));
  return async (audio) => {
    const stream = rec.createStream();
    stream.acceptWaveform({ samples: audio, sampleRate: 16000 });
    return { text: parakeetText(await rec.decodeAsync(stream)) };
  };
};

export function loadVoiceAsr(lang: VoiceLang = "en"): Promise<Asr> {
  const key = voiceEngine(process.env.ORBIT_ASR, !!g.__orbitVoiceNoParakeet) === "parakeet" ? "parakeet" as const : null;
  if (key) {
    const cache = (g.__orbitVoiceAsr ??= {});
    const p = cache.parakeet ??= parakeetAsr();
    p.catch((e) => {
      if (cache.parakeet === p) cache.parakeet = undefined;
      g.__orbitVoiceNoParakeet = true; // fall back to Whisper from now on
      console.error("[orbit] Parakeet unavailable for voice, using Whisper:", e instanceof Error ? e.message : e);
    });
    return p.catch(() => loadWhisper(lang));
  }
  return loadWhisper(lang);
}

function loadWhisper(lang: VoiceLang): Promise<Asr> {
  const key = lang === "en" ? "en" : "multi", cache = (g.__orbitVoiceAsr ??= {});
  // Own worker lane (asr-pool), so voice never waits behind clip transcription.
  // fp32 encoder for accuracy, 8-bit decoder for speed (the decoder runs once per token).
  const p = cache[key] ??= asrPipeline("voice", key === "en" ? MODEL : MULTI, { dtype: { encoder_model: "fp32", decoder_model_merged: "q8" } }, path.join(studioRoot(), "models")) as Promise<Asr>;
  p.catch(() => { if (cache[key] === p) cache[key] = undefined; }); // let the next request retry a failed download
  return p;
}

/** One at a time: parallel runs would each grab every CPU core and all get slower. */
export function transcribeSpeech(audio: Float32Array, lang: VoiceLang = "en"): Promise<string> {
  const run = async () => {
    const asr = await loadVoiceAsr(lang);
    if (g.__orbitVoiceAsr?.parakeet && !g.__orbitVoiceNoParakeet) return ((await asr(audio)) as { text?: string }).text ?? "";
    // Over 30 s (voice memos): Whisper's window is 30 s, so transcribe in overlapping chunks.
    const long = audio.length > 30 * 16000 ? { chunk_length_s: 30, stride_length_s: 5 } : undefined;
    const out = await asr(audio, lang === "en" ? long : { task: "transcribe", ...(lang === "et" ? { language: "estonian" } : {}), ...long });
    return (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
  };
  g.__orbitVoiceN = voiceQueue() + 1;
  const p = (g.__orbitVoiceQ ?? Promise.resolve()).then(run, run).finally(() => { g.__orbitVoiceN = voiceQueue() - 1; });
  g.__orbitVoiceQ = p.catch(() => {});
  return p;
}
