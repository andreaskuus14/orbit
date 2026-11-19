// Pure parts of voice transcription's engine choice (runner: voice-asr.ts).
import { wantParakeet } from "./clips/parakeet-pure.ts";

export type VoiceEngine = "parakeet" | "whisper";
/** Parakeet first unless ORBIT_ASR=whisper; `parakeetFailed` (it couldn't load) drops to Whisper. */
export const voiceEngine = (env: string | undefined, parakeetFailed: boolean): VoiceEngine => (wantParakeet(env) && !parakeetFailed ? "parakeet" : "whisper");

/** sherpa-onnx result → plain text (its own `text`, else the tokens joined). Whisper-shaped callers get `{ text }`. */
export function parakeetText(r: { text?: string; tokens?: string[] } | null | undefined): string {
  if (!r) return "";
  const t = typeof r.text === "string" ? r.text : (r.tokens ?? []).join("");
  return t.replace(/\s+/g, " ").trim();
}
