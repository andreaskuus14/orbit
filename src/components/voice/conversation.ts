// Conversation mode: after "Orbit, let's talk" ORBIT keeps listening after each answer without the wake word.
// Pure (no DOM): the phase machine, start/end phrases and which open-mic speech is meant for ORBIT. Tested in tests/voice-conversation.test.ts.
import { parseNavCommand } from "../../lib/nav-pure.ts";
import type { PanelId } from "../../lib/planets.ts";
import { isSleepCommand, normalizeTranscript } from "./wake.ts";

export const SILENCE_MS = 30_000; // "one follow-up" mode: this long with nobody talking ends it
export const IDLE_MS = 5 * 60_000; // "stay" mode (open mic): this long listening without asking ORBIT anything ends it
export const CAP_MS = 30 * 60_000; // …and this long without a question ends it in any phase (a stuck "speaking" can't hold the mic)
export const THINK_MS = 45_000; // asked but ORBIT never spoke (speech off, error): go back to listening. CORE's first sentence can take 20+ s

export type ConvPhase = "idle" | "listening" | "thinking" | "speaking";
/** asked: questions sent in this conversation. persist false = "one follow-up only": ends after the 2nd answer.
 *  streams: CORE answers still streaming (an interrupted one finishes after the next ask). While any stream, a pause in
 *  speech is a gap between sentences, not the end of the answer. */
export type Conv = { phase: ConvPhase; since: number; asked: number; persist: boolean; streams: number; idleSince: number };
export type ConvEvent =
  | { type: "start"; persist: boolean } | { type: "stop" }
  | { type: "hearing" } // the user is talking (interim speech): keep the silence timer from firing
  | { type: "ask"; core?: boolean } // core false: answered by Orbit itself (navigation), no stream to wait for
  | { type: "done" } | { type: "speaking" } | { type: "spoke" } | { type: "tick" };

/** idleSince: last start or question. `since` moves on every phase change (any speakChunk caller), so it can't time idleness. */
export const IDLE: Conv = { phase: "idle", since: 0, asked: 0, persist: true, streams: 0, idleSince: 0 };

/** idle → listening → thinking → speaking → listening …; back to listening only once the answer is done AND spoken.
 *  Ends on stop, the follow-up limit, 30 s of silence (one follow-up) or 5 min without a question (stay). */
export function convStep(s: Conv, e: ConvEvent, now: number): Conv {
  if (e.type === "start") return { phase: "listening", since: now, asked: 0, persist: e.persist, streams: 0, idleSince: now };
  if (s.phase === "idle") return s;
  switch (e.type) {
    case "stop": return IDLE;
    // Stay mode ignores mere speech: a TV or other people talking must not hold the open mic forever.
    case "hearing": return s.phase === "listening" && !s.persist ? { ...s, since: now } : s;
    case "ask": return { ...s, phase: "thinking", since: now, idleSince: now, asked: s.asked + 1, streams: s.streams + (e.core === false ? 0 : 1) };
    case "done": { // speaking: wait for "spoke"
      const t = { ...s, streams: Math.max(0, s.streams - 1) };
      return t.phase === "thinking" && !t.streams ? finished(t, now) : t;
    }
    case "speaking": return { ...s, phase: "speaking", since: now };
    case "spoke": return s.streams ? { ...s, phase: "thinking", since: now } : finished(s, now); // gap between streamed sentences
    case "tick":
      if (s.persist ? now - s.idleSince >= CAP_MS || (s.phase === "listening" && now - s.idleSince >= IDLE_MS) : s.phase === "listening" && now - s.since >= SILENCE_MS) return IDLE;
      return s.phase === "thinking" && now - s.since >= THINK_MS ? { ...s, phase: "listening", since: now, streams: 0 } : s;
  }
}
const finished = (s: Conv, now: number): Conv => !s.persist && s.asked >= 2 ? IDLE : { ...s, phase: "listening", since: now };

const ORBIT = String.raw`(?:(?:hey|ok|okay)[\s,]+)?(?:orbit[\s,.!]+)?`;
const START = new RegExp(String.raw`^${ORBIT}(?:(?:let'?s|let us)\s+(?:just\s+)?(?:talk|chat|have a (?:chat|conversation)|keep talking)(?:\s+for a (?:bit|while))?|(?:start\s+|enter\s+|turn on\s+)?(?:conversation|talk|open mic) mode(?:\s+on)?|(?:stay|keep) listening|open mic)\W*$`, "i");
const END = new RegExp(String.raw`^${ORBIT}(?:(?:no|yes|yeah|ok|okay|thanks|thank you)[\s,.!]+)*(?:bye bye|that'?s enough|that'?s all|that is all|that'?ll be all|that'?s it|we'?re done|stop listening|good ?bye|bye|end (?:the )?conversation|(?:stop|exit|end) (?:conversation|talk|open mic) mode|(?:conversation|talk) mode off|close (?:the )?mic)(?:[\s,.]+(?:orbit|thanks|thank you|for now|please))*\W*$`, "i");
export const isConversationStart = (text: string) => START.test(text.trim());
/** Starts open mic? The whole utterance must be the phrase; without "Orbit" only the "let's just talk/chat" forms count
 *  (a TV saying "let's talk" mustn't open the mic). */
export const startsConversation = (text: string, byWake: boolean) => isConversationStart(text) && (byWake || /\bjust\b/i.test(text));
export const isConversationEnd = (text: string) => END.test(text.trim());

const FILLER = new Set(["uh", "um", "umm", "uhm", "hmm", "mm", "er", "erm", "ah", "oh"]);
const words = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => !FILLER.has(w));
const LEAD = /^(?:(?:so|and|but|okay|ok|well|hey|right|alright|now|actually|also|then)[\s,]+)+/i;
const QUESTION = /^(?:who|whom|whose|what|what's|whats|when|where|which|why|how|is|isn't|are|aren't|was|were|do|does|did|can(?!'t)|could|would|won't|should|shall|any)\b/i;
const COMMAND = /^(?:please[\s,]+)?(?:tell (?:me|us)|show (?:me|us)|give (?:me|us)|open|close|search|find|look up|remind|remember|save|add|note|play|read|explain|summari[sz]e|describe|help|check|go to|take me|bring up|pull up|zoom|start|set|make|create|write|draft|list|compare|translate|calculate|define|plan|schedule|send|turn (?:on|off|up|down)|switch|follow|unfollow|next|more|continue|louder|quieter|repeat|again)\b/i;
const ASKING = /^please\b|\bplease\W*$|\b(?:can you|could you|would you|will you|do you|are you|i (?:want|need|wonder|would like)|i'd like)\b/i;

/** Open mic: is this utterance meant for ORBIT? Questions, requests, commands or its name count; short filler and room
 *  talk ("yeah", "ok", "it's cold in here") don't. orbitAsked: ORBIT just asked something, so a short reply counts. */
export function isAddressedToOrbit(text: string, ctx: { current?: PanelId | null } = {}, orbitAsked = false): boolean {
  const t = normalizeTranscript(text), w = words(t);
  if (!w.length) return false;
  if (w.includes("orbit") || (orbitAsked && w.length <= 6) || isSleepCommand(t) || parseNavCommand(t, ctx)) return true;
  const s = t.replace(LEAD, "");
  if (COMMAND.test(s)) return true; // "help", "zoom in": a command may be one word
  if (w.length < 2) return false;
  return /\?\s*$/.test(t) || QUESTION.test(s) || ASKING.test(s);
}
