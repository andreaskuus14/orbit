// Pure transcript helpers for voice input (no DOM) — tested in tests/voice-wake.test.ts.

/** Collapse whitespace and trim a recognizer transcript. */
export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// "hey orbit", "okay orbit", "ok orbit", mishearings ("hey orbits", "a orbit", "hay orbit"), or just "orbit" when it
// starts the utterance ("Orbit, what's the news?") — mid-sentence "orbit" ("the moon's orbit") doesn't count.
const WAKE = /(?:^\s*|\b(?:hey|hay|hi|okay|ok|a)[\s,.!-]+)orbits?\b[\s,.!?:;-]*/i;

/**
 * Find the wake phrase in a transcript. Returns null when absent, otherwise the question that follows it
 * ("" when the user only said the wake phrase, so the next utterance is the question).
 */
export function extractWakeQuestion(text: string): { question: string } | null {
  const m = WAKE.exec(text);
  if (!m) return null;
  const question = normalizeTranscript(text.slice(m.index + m[0].length));
  return { question: question ? question[0].toUpperCase() + question.slice(1) : "" };
}

// "Orbit, shut down" / "orbit go to sleep" / "close orbit" / "goodbye orbit": handled in the app, never sent to the model.
const SLEEP = /^(?:(?:hey|ok|okay|all right|alright)[\s,]+)?(?:orbit(?:al|s)?[\s,.!]+(?:shut ?down|go to sleep|sleep|close|turn off|power off|bye|goodbye)|(?:shut ?down|close|turn off|goodbye|bye)[\s,]+orbit(?:al|s)?)[\s.!]*$/i;

/** True when the whole message is a "shut ORBIT down" command. */
export function isSleepCommand(text: string): boolean {
  return SLEEP.test(normalizeTranscript(text));
}
