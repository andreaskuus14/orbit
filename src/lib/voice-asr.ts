import path from "node:path";
import { studioRoot } from "./clips/factory";
import { asrPipeline } from "./asr-pool";
import { parakeetText, voicePlan, type VoiceEngine } from "./voice-asr-pure";
import { asrPlan, guessLang, type VoiceLang } from "./voice-et-pure";
import { etDead, etInstalled, prefetchEt, transcribeEt, warmEtAsr } from "./voice-et";

// Voice input's Whisper: an English-only model (more accurate on accented English than the clip factory's multilingual
// base). Same transformers.js runtime and model cache folder as the clip factory.
const MODEL = process.env.ORBIT_VOICE_WHISPER_MODEL || "Xenova/whisper-small.en";
// Estonian / auto-detect: the multilingual sibling, loaded only the first time someone asks for it (another ~1 GB in RAM).
const MULTI = process.env.ORBIT_VOICE_WHISPER_MULTI_MODEL || "Xenova/whisper-small";
export type { VoiceLang };

type Asr = (audio: Float32Array, o?: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
type Picked = { engine: VoiceEngine; asr: Asr };
// On globalThis so dev hot reloads keep one loaded model.
const g = globalThis as unknown as { __orbitVoiceAsr?: Partial<Record<"en" | "multi" | "parakeet", Promise<Asr>>>; __orbitVoiceNoParakeet?: boolean;
  __orbitVoiceDl?: boolean; __orbitVoicePkOnDisk?: boolean; __orbitVoiceQ?: Promise<unknown>; __orbitVoiceN?: number };
export const MAX_VOICE_QUEUE = 4;
/** Transcriptions queued or running: past MAX_VOICE_QUEUE the route answers 429 instead of piling up stale audio. */
export const voiceQueue = () => g.__orbitVoiceN ?? 0;
export { parseVoiceLang } from "./voice-et-pure";
const modelsDir = () => path.join(studioRoot(), "models");

// Parakeet TDT v3 in its own child process (clips/parakeet.ts, voice lane): auto-detects the language, so `lang` is ignored.
// Short utterances decode in one go, no piece splitting. Whisper while its model is still downloading, when it can't load,
// or with ORBIT_ASR=whisper.
const parakeetAsr = async (): Promise<Asr> => {
  const { parakeetDecoder } = await import("./clips/parakeet");
  const dec = await parakeetDecoder("voice", modelsDir());
  return async (audio) => ({ text: parakeetText(await dec(audio)) });
};

const dropParakeet = (e: unknown) => {
  g.__orbitVoiceNoParakeet = true; // Whisper from now on (until a restart)
  console.error("[orbit] Parakeet unavailable for voice, using Whisper:", e instanceof Error ? e.message : e);
};

async function pickVoiceAsr(lang: VoiceLang): Promise<Picked> {
  const pk = await import("./clips/parakeet");
  if (!g.__orbitVoicePkOnDisk) g.__orbitVoicePkOnDisk = await pk.parakeetInstalled(modelsDir());
  const plan = voicePlan({ env: process.env.ORBIT_ASR, failed: !!g.__orbitVoiceNoParakeet, available: pk.parakeetAvailable(), installed: g.__orbitVoicePkOnDisk, downloading: !!g.__orbitVoiceDl });
  if (plan.download) { // first use: fetch the model in the background; this utterance (and the next ones until it's in) go to Whisper
    g.__orbitVoiceDl = true;
    pk.ensureParakeetModel(modelsDir()).then(() => { g.__orbitVoicePkOnDisk = true; console.log("[orbit] Parakeet model downloaded; voice switches to it"); },
      (e) => console.error("[orbit] Parakeet model download failed (voice stays on Whisper, retries later):", e instanceof Error ? e.message : e))
      .finally(() => { g.__orbitVoiceDl = false; });
  }
  if (plan.engine === "parakeet") {
    const cache = (g.__orbitVoiceAsr ??= {});
    const p = cache.parakeet ??= parakeetAsr();
    try { return { engine: "parakeet", asr: await p }; } catch (e) {
      if (cache.parakeet === p) cache.parakeet = undefined;
      dropParakeet(e);
    }
  }
  return { engine: "whisper", asr: await loadWhisper(lang) };
}

/** The Estonian model (voice-et.ts) is on disk and its child hasn't given up. Asking for et/auto before that starts its download. */
async function etReady(lang: VoiceLang): Promise<boolean> {
  if (lang === "en" || etDead("asr")) return false;
  if (await etInstalled("asr")) return true;
  prefetchEt(); // ~230 MB once, in the background; Parakeet / Whisper answer meanwhile
  return false;
}

/** Warms (and checks) the engine voice will use now. Estonian: the Estonian model when it's in, else the old path. */
export async function loadVoiceAsr(lang: VoiceLang = "en"): Promise<unknown> {
  if (lang === "et" && await etReady(lang)) { try { return await warmEtAsr(); } catch (e) { console.error("[orbit] Estonian ASR didn't load, using the fallback:", e instanceof Error ? e.message : e); } }
  return pickVoiceAsr(lang === "auto" && await etReady(lang) ? "en" : lang).then((x) => x.asr);
}

function loadWhisper(lang: VoiceLang): Promise<Asr> {
  const key = lang === "en" ? "en" : "multi", cache = (g.__orbitVoiceAsr ??= {});
  // Own worker lane (asr-pool), so voice never waits behind clip transcription.
  // fp32 encoder for accuracy, 8-bit decoder for speed (the decoder runs once per token).
  const p = cache[key] ??= asrPipeline("voice", key === "en" ? MODEL : MULTI, { dtype: { encoder_model: "fp32", decoder_model_merged: "q8" } }, modelsDir()) as Promise<Asr>;
  p.catch(() => { if (cache[key] === p) cache[key] = undefined; }); // let the next request retry a failed download
  return p;
}

// The old path: Parakeet (any language) or Whisper (English-only, or multilingual for et/auto).
async function transcribeBase(audio: Float32Array, lang: VoiceLang): Promise<string> {
  let { engine, asr } = await pickVoiceAsr(lang);
  if (engine === "parakeet") {
    try { return ((await asr(audio)) as { text?: string }).text ?? ""; } catch (e) { // its child crashed or gave up: this utterance goes to Whisper
      if (g.__orbitVoiceAsr) g.__orbitVoiceAsr.parakeet = undefined;
      dropParakeet(e);
      asr = await loadWhisper(lang);
    }
  }
  // Over 30 s (voice memos): Whisper's window is 30 s, so transcribe in overlapping chunks.
  const long = audio.length > 30 * 16000 ? { chunk_length_s: 30, stride_length_s: 5 } : undefined;
  const out = await asr(audio, lang === "en" ? long : { task: "transcribe", ...(lang === "et" ? { language: "estonian" } : {}), ...long });
  return (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
}

const etOr = (audio: Float32Array, fallback: () => Promise<string>) => transcribeEt(audio).catch((e) => {
  console.error("[orbit] Estonian ASR failed, using the fallback:", e instanceof Error ? e.message : e);
  return fallback();
});

/** lang "et": the Estonian model. "auto": per utterance — with Parakeet, its transcript decides (Estonian → the Estonian model, which is
 *  far more accurate on Estonian: 7 % vs 19 % word errors on FLEURS); without it, the Estonian model first and English Whisper when that
 *  reads as English. Until the Estonian model is in, the old path. One at a time: parallel runs would each grab every CPU core. */
export function transcribeSpeech(audio: Float32Array, lang: VoiceLang = "en"): Promise<string> {
  const run = async () => {
    const plan = asrPlan(lang, await etReady(lang));
    if (plan === "en") return transcribeBase(audio, lang);
    if (plan === "et") return etOr(audio, () => transcribeBase(audio, "et"));
    const first = await pickVoiceAsr("en");
    if (first.engine === "parakeet") {
      const text = await transcribeBase(audio, "en");
      return guessLang(text) === "et" ? etOr(audio, async () => text) : text;
    }
    const et = await etOr(audio, () => transcribeBase(audio, "auto"));
    return guessLang(et) === "en" ? transcribeBase(audio, "en") : et;
  };
  g.__orbitVoiceN = voiceQueue() + 1;
  const p = (g.__orbitVoiceQ ?? Promise.resolve()).then(run, run).finally(() => { g.__orbitVoiceN = voiceQueue() - 1; });
  g.__orbitVoiceQ = p.catch(() => {});
  return p;
}
