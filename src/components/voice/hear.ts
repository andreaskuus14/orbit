// Pure helpers that help voice input hear ORBIT's words: fixes for common mishearings, picking the best of the
// recognizer's alternatives, and joining a sentence Chrome split into several finals. No DOM — tested in tests/voice-hear.test.ts.
import { parseNavCommand } from "../../lib/nav-pure.ts";
import type { PanelId } from "../../lib/planets.ts";
import { extractWakeQuestion, isSleepCommand, normalizeTranscript } from "./wake.ts";

// The whole utterance must be the command, optionally after "(hey) Orbit": "stop", "Orbit, stop", "be quiet".
export const STOP_WORDS = /^\s*(?:(?:hey|ok|okay)?[\s,]*orbit[\s,.!]+)?(?:please[\s,]+)?(stop(?: it| talking| please)?|wait|hold on|enough|quiet|be quiet|shut up|pause|okay stop|ok stop|no|peata|vait|oota|aitab)\W*$/iu; // + Estonian: stop, quiet, wait, enough

// Never real English as heard, so safe anywhere in a sentence.
const ANYWHERE: [RegExp, string][] = [
  [/\b(?:a|east|es) ston[iy]a(n?)\b/gi, "Estonia$1"],
  [/\bis ston[iy]a(n?)\b/gi, "is Estonia$1"], // keep the real word: "is stonia nice" → "is Estonia nice"
  [/\bestonya(n?)\b/gi, "Estonia$1"],
  [/\b(?:in telligence|intelli gents|intelligents)\b/gi, "intelligence"],
];

// "or bit, open studio" → "Orbit, open studio". Only at the start and only before a command/question word (or alone),
// so "a bit more detail" and "orbital mechanics" stay as said.
const NEXT = "go|fly|open|show|take|bring|pull|zoom|search|find|switch|navigate|close|shut|turn|power|wake|woke|what|whats|what's|who|how|why|when|where|which|can|could|tell|give|play|remind|remember|save|add|make|create|start|read";
const WAKE_FIX = new RegExp(`^(?:(hey|hi|ok|okay)[\\s,]+)?(?:or bits?|our bit|all bit|ore bit|(?<=(?:hey|hi|ok|okay)[\\s,]+)(?:orbital|a bits?)|orbital(?=[\\s,]+(?:wake|woke)\\b))(?=[\\s,.!?]*$|[\\s,.]+(?:${NEXT})\\b)`, "i");

// Place words misheard right after a navigation verb ("open the stereo"); elsewhere these are normal words.
const SLOT = /^((?:(?:hey |ok |okay )?orbit,? )?(?:please )?(?:go to|go back to|fly to|open(?: up)?|show(?: me)?|take me to|switch to|navigate to|bring up|pull up|launch)(?: the| my)? )(.+?)([.!?]?)$/i;
const PLACE_FIX: [RegExp, string][] = [
  [/^(?:intelligent|intelligences|intel|intel agents)$/i, "intelligence"],
  [/^(?:studios|stereo|studia|stu dio)$/i, "studio"],
  [/^(?:clip|klips?|clipse|cleaps?|eclipses?|the eclipses?)$/i, "clips"], // "take me to the eclipse" = the clips
  [/^(?:stat|stets|stads|statts)$/i, "stats"],
];

/** Fix common mishearings of ORBIT's vocabulary (whole words only). */
export function correctTranscript(text: string): string {
  let t = normalizeTranscript(text);
  for (const [re, to] of ANYWHERE) t = t.replace(re, to);
  t = t.replace(WAKE_FIX, (_, hey?: string) => (hey ? `${hey} ` : "") + "Orbit");
  const m = SLOT.exec(t);
  const fix = m && PLACE_FIX.find(([re]) => re.test(m[2]));
  return fix && m ? m[1] + fix[1] + m[3] : t;
}

export type HearCtx = { current?: PanelId | null };

/** The recognizer's alternatives for one final result → the best one, corrected: one that is a navigation, sleep or stop
 *  command or contains the wake word beats a plain sentence; otherwise the recognizer's own top pick. */
export function pickBestAlternative(alts: string[], ctx: HearCtx = {}): string {
  let best = "", top = -1;
  // A question as the top pick stays a question: "what's in my studio" must not turn into the alternative "open studio".
  const question = /^(?:what|whats|what's|who|how|why|when|where|which|is|are|can|could|do|does|did)\b/i.test(normalizeTranscript(alts[0] ?? ""));
  alts.forEach((a, i) => {
    const t = correctTranscript(a);
    if (!t) return;
    // Lower alternatives may pick a command, never create a wake: room talk ending in "a bit" mustn't arm ORBIT.
    const nav = parseNavCommand(t, ctx);
    if (i > 0 && (nav?.stopAll || nav?.voice !== undefined)) return; // never invent a destructive command or unmute from a lower guess
    // A lower guess may not start the timer or jump to a LIFE tab ("journal" heard inside "journal entry for today").
    const cmd = (i === 0 || !question) && ((nav && (i === 0 || !nav.life)) || isSleepCommand(t));
    const score = cmd ? 2 : (i === 0 && extractWakeQuestion(t)) || (STOP_WORDS.test(t) && (i === 0 || !question)) ? 1 : 0; // a lower guess "stop" never beats a real question
    if (score > top) { best = t; top = score; }
  });
  return best;
}

/** Join consecutive finals into one sentence, dropping words Chrome repeated across the seam (2+ word overlap). */
export function mergeFinals(parts: string[]): string {
  const out: string[] = [];
  const key = (w: string[]) => w.join(" ").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
  for (const p of parts) {
    const w = normalizeTranscript(p).split(" ").filter(Boolean);
    let k = Math.min(out.length, w.length);
    for (; k >= 2; k--) if (key(out.slice(-k)) === key(w.slice(0, k))) break;
    out.push(...w.slice(k >= 2 ? k : 0));
  }
  return out.join(" ");
}

// An utterance ending like this is a speaker pausing to think mid-sentence, not a finished question.
const TRAILING = /\b(?:and|or|but|the|a|an|to|of|with|for|uh|uhm|um|umm|erm|er|hmm|like|so|because|if|my|your|in|on|at|is|are|about|from|what|how)\W*$/i;
export const ENDPOINT_MS = 1500, ENDPOINT_LONG_MS = 2500;
/** How long to wait after the last recognizer result before treating `text` as finished. */
export function endpointDelay(text: string): number {
  const t = normalizeTranscript(text), q = extractWakeQuestion(t)?.question ?? t;
  // A complete command ("open studio", "zoom in" — its "in" isn't trailing) shouldn't wait the long pause.
  if (parseNavCommand(q, { current: "intelligence" }) || isSleepCommand(t)) return ENDPOINT_MS;
  return q.split(" ").filter(Boolean).length < 3 || TRAILING.test(q) ? ENDPOINT_LONG_MS : ENDPOINT_MS;
}

export const TURN_MS = 600, TURN_LONG_MS = 1400;
/** ORBIT mic end of turn: how much longer to wait, `quietMs` after speech stopped, before answering `text` — short after
 *  a complete sentence or command, long after "and", "um", "so" or a fragment. 0 = answer now. */
export function turnWaitMs(text: string, quietMs: number): number {
  const t = normalizeTranscript(text), q = extractWakeQuestion(t)?.question ?? t;
  const done = parseNavCommand(q, { current: "intelligence" }) || isSleepCommand(t) || (/[.?!]$/.test(q) || q.split(" ").length >= 3) && !TRAILING.test(q);
  return Math.max(0, (done ? TURN_MS : TURN_LONG_MS) - quietMs);
}

// Words too common to tell ORBIT's voice from the user's (plus the wake word itself).
const COMMON = new Set("orbit orbits the and but for you your are was were what what's with this that from have has not can its it's".split(" "));
const echoWords = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []).filter((w) => !COMMON.has(w));
/** True when `heard` is mostly words of `spoken` (ORBIT's own voice coming back through the speakers). Nothing
 *  word-like (noise, "uh", "a") counts as echo too: it is never a reason to act. */
export function isEcho(heard: string, spoken: string): boolean {
  // Stop phrases and "Orbit, …" questions are made of common words: echo only when ORBIT just said that exact phrase.
  if (STOP_WORDS.test(heard) || extractWakeQuestion(heard)) return saidPhrase(heard, spoken);
  const w = echoWords(heard);
  if (!w.length) return true;
  const said = new Set(echoWords(spoken));
  return w.filter((x) => said.has(x)).length / w.length >= 0.5;
}

/** While ORBIT speaks, only a stop phrase or the wake word starting a new question may cut it off — never noise,
 *  other speech, or ORBIT's own echo. */
export function shouldBargeIn(heard: string, spoken: string): "stop" | "wake" | null {
  if (isEcho(heard, spoken)) return null;
  return STOP_WORDS.test(heard) || parseNavCommand(heard)?.stopAll ? "stop" : extractWakeQuestion(heard) ? "wake" : null;
}
const allWords = (t: string) => ` ${(t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).join(" ")} `;
const saidPhrase = (heard: string, spoken: string) => allWords(heard).trim() !== "" && allWords(spoken).includes(allWords(heard));

/** Collects finals and flushes them as one text once nobody has spoken for the grace time (hold() = interim speech,
 *  keep waiting; the interim text counts toward the adaptive delay and is kept if the flush comes first), but never
 *  later than maxMs after the first one. */
export function finalJoiner(grace: number | ((text: string) => number), flush: (text: string) => void, maxMs = 30_000) {
  let parts: string[] = [], tail = "", since = 0, t: ReturnType<typeof setTimeout> | undefined;
  const fire = () => { t = undefined; const text = mergeFinals(tail ? [...parts, tail] : parts); parts = []; tail = ""; if (text) flush(text); };
  const wait = () => {
    const g = typeof grace === "number" ? grace : grace(mergeFinals(tail ? [...parts, tail] : parts));
    clearTimeout(t); t = setTimeout(fire, Math.max(0, Math.min(g, since + maxMs - Date.now())));
  };
  return {
    add(text: string) { if (!parts.length) since = Date.now(); parts.push(text); tail = ""; wait(); },
    hold(interim = "") { if (parts.length) { tail = interim; wait(); } },
    get pending() { return parts.length > 0; },
    cancel() { clearTimeout(t); t = undefined; parts = []; tail = ""; },
  };
}

/** Whisper output → plain text: drop [BLANK_AUDIO]/(music) tags and the stock lines it invents for noise. */
export function cleanWhisperText(text: string): string {
  const t = normalizeTranscript(text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " "));
  return /^(?:you|\.+|thanks for watching!?|thank you for watching!?)$/i.test(t) ? "" : t;
}
