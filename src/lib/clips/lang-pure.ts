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

// Fallback when Whisper can't load (Parakeet has no language guess): share of very common English words in the
// transcript. English speech runs ~35-50 %; other languages written by Parakeet sit far below. Too little speech = unknown.
const EN_COMMON = new Set("the a an and or but to of in on at for with is are was were be been it this that i you he she we they me my your not no do did have has what so just like yeah oh go get got can will if there here all up out".split(" "));

export function transcriptLanguage(words: { text: string }[]): "english" | "other" | "unknown" {
  const ws = words.slice(0, 400).map((w) => w.text.toLowerCase().replace(/[^\p{L}']/gu, "")).filter(Boolean);
  if (ws.length < 40) return "unknown";
  return ws.filter((w) => EN_COMMON.has(w)).length / ws.length >= 0.15 ? "english" : "other";
}
