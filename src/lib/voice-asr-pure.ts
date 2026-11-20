// Pure parts of voice transcription's engine choice (runner: voice-asr.ts).
import { wantParakeet } from "./clips/parakeet-pure.ts";

export type VoiceEngine = "parakeet" | "whisper";
/** Parakeet first unless ORBIT_ASR=whisper; `parakeetFailed` (it couldn't load) drops to Whisper. */
export const voiceEngine = (env: string | undefined, parakeetFailed: boolean): VoiceEngine => (wantParakeet(env) && !parakeetFailed ? "parakeet" : "whisper");

/** Which engine this utterance uses, and whether to start Parakeet's model download in the background. Voice never waits for
 *  the ~487 MB first download: Whisper answers until the model is on disk (`installed`). `available` = sherpa-onnx is installed
 *  and its worker hasn't given up; `downloading` = a download is already running. */
export function voicePlan(x: { env: string | undefined; failed: boolean; available: boolean; installed: boolean; downloading: boolean }): { engine: VoiceEngine; download: boolean } {
  if (voiceEngine(x.env, x.failed) === "whisper" || !x.available) return { engine: "whisper", download: false };
  if (x.installed) return { engine: "parakeet", download: false };
  return { engine: "whisper", download: !x.downloading };
}

/** sherpa-onnx result → plain text (its own `text`, else the tokens joined). Whisper-shaped callers get `{ text }`. */
export function parakeetText(r: { text?: string; tokens?: string[] } | null | undefined): string {
  if (!r) return "";
  const t = typeof r.text === "string" ? r.text : (r.tokens ?? []).join("");
  return t.replace(/\s+/g, " ").trim();
}
