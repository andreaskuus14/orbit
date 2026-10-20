// English-only clips: Whisper forced to English (and transformers.js with no language, which assumes English) writes
// English text even for Chinese speech, so a non-English video got English captions. Whisper's own language guess
// on a few samples (asr-worker detectLanguage) decides instead.

/** Verdict from the detected language of up to 3 samples: "other" when most clear guesses aren't English. */
export function languageVerdict(codes: (string | null)[]): "english" | "other" | "unknown" {
  const known = codes.filter((c): c is string => !!c);
  if (!known.length) return "unknown"; // English-only model, or no speech: don't block
  const en = known.filter((c) => c === "en").length;
  return en * 2 >= known.length ? "english" : "other";
}
