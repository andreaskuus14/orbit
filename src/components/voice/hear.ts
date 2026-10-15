// Pure helpers that help voice input hear ORBIT's words: fixes for common mishearings, picking the best of the
// recognizer's alternatives, and joining a sentence Chrome split into several finals. No DOM — tested in tests/voice-hear.test.ts.
import { parseNavCommand } from "../../lib/nav-pure.ts";
import type { PanelId } from "../../lib/planets.ts";
import { extractWakeQuestion, isSleepCommand, normalizeTranscript } from "./wake.ts";

export const STOP_WORDS = /^\s*(stop|wait|hold on|enough|quiet|shut up|pause|okay stop|ok stop|no)\W*$/i;

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
  [/^(?:clip|klips?|clipse|cleaps?)$/i, "clips"],
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
    const cmd = (i === 0 || !question) && (parseNavCommand(t, ctx) || isSleepCommand(t));
    const score = cmd ? 2 : (i === 0 && extractWakeQuestion(t)) || STOP_WORDS.test(t) ? 1 : 0;
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

/** Collects finals and flushes them as one text once nobody has spoken for graceMs (hold() = interim speech, keep
 *  waiting), but never later than maxMs after the first one. */
export function finalJoiner(graceMs: number, flush: (text: string) => void, maxMs = 10_000) {
  let parts: string[] = [], since = 0, t: ReturnType<typeof setTimeout> | undefined;
  const fire = () => { t = undefined; const text = mergeFinals(parts); parts = []; if (text) flush(text); };
  const wait = () => { clearTimeout(t); t = setTimeout(fire, Math.max(0, Math.min(graceMs, since + maxMs - Date.now()))); };
  return {
    add(text: string) { if (!parts.length) since = Date.now(); parts.push(text); wait(); },
    hold() { if (parts.length) wait(); },
    get pending() { return parts.length > 0; },
    cancel() { clearTimeout(t); t = undefined; parts = []; },
  };
}

/** Whisper output → plain text: drop [BLANK_AUDIO]/(music) tags and the stock lines it invents for noise. */
export function cleanWhisperText(text: string): string {
  const t = normalizeTranscript(text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " "));
  return /^(?:you|\.+|thanks for watching!?|thank you for watching!?)$/i.test(t) ? "" : t;
}
