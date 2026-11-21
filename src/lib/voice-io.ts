// ORBIT's voice, both ways, in one place on the server: `transcribe(audio, lang?)` and `speak(text, lang?)`. For CORE voice, the
// "ORBIT wants to talk" call and the JARVIS wake-word loop. English: Parakeet / Whisper in, Kokoro out. Estonian: TalTech's Zipformer in,
// Piper's Estonian voice out (voice-et.ts). Everything heavy runs in child processes; nothing here loads a model in the server.
import { encodeWav } from "./audio-pure";
import { kokoroTts } from "./clips/kokoro";
import { transcribeSpeech } from "./voice-asr";
import { etInstalled, speakEt } from "./voice-et";
import { ttsLang, type VoiceLang } from "./voice-et-pure";

export type { VoiceLang };
/** No lang given: "auto" once the Estonian model is on disk (the owner talks both), else English (no surprise download). */
const defaultLang = async (): Promise<VoiceLang> => ((await etInstalled("asr")) ? "auto" : "en");

/** 16 kHz mono → text. */
export async function transcribe(audio: Float32Array, lang?: VoiceLang): Promise<string> {
  return transcribeSpeech(audio, lang ?? await defaultLang());
}

export type Spoken = { audio: Float32Array; rate: number; lang: "en" | "et" };
/** Text → audio. "auto" (the default) picks by the words: Estonian → Piper, else Kokoro. `voice`: a Kokoro voice ("af_heart") or an
 *  Estonian one ("Mari"); the wrong kind is ignored. If the Estonian voice can't run, English text still speaks; Estonian text throws. */
export async function speak(text: string, lang: VoiceLang = "auto", o: { voice?: string | null; etVoice?: string | null; rate?: number } = {}): Promise<Spoken> {
  const l = ttsLang(lang, text);
  if (l === "et") return { ...(await speakEt(text, { voice: o.etVoice, rate: o.rate })), lang: "et" };
  const out = await (await kokoroTts()).generate(text, { voice: o.voice && !/^[A-Z]/.test(o.voice) ? o.voice : "af_heart", ...(o.rate ? { speed: o.rate } : {}) });
  return { audio: out.audio, rate: out.sampling_rate, lang: "en" };
}

/** speak() as a 16-bit WAV. */
export const speakWav = async (text: string, lang?: VoiceLang, o?: Parameters<typeof speak>[2]) => {
  const s = await speak(text, lang, o);
  return { wav: encodeWav(s.audio, s.rate), lang: s.lang };
};
