// Conversation mode: after "Orbit, let's talk" ORBIT keeps listening after each answer without the wake word.
// Pure (no DOM): the phase machine, start/end phrases and the barge-in rule. Tested in tests/voice-conversation.test.ts.
import { isEcho } from "./hear.ts";

export const SILENCE_MS = 30_000; // "one follow-up" mode: this long with nobody talking ends it ("stay" mode is open mic until told to stop)
export const THINK_MS = 20_000; // asked but ORBIT never spoke (speech off, error): go back to listening

export type ConvPhase = "idle" | "listening" | "thinking" | "speaking";
/** asked: questions sent in this conversation. persist false = "one follow-up only": ends after the 2nd answer.
 *  streams: CORE answers still streaming (an interrupted one finishes after the next ask). While any stream, a pause in
 *  speech is a gap between sentences, not the end of the answer. */
export type Conv = { phase: ConvPhase; since: number; asked: number; persist: boolean; streams: number };
export type ConvEvent =
  | { type: "start"; persist: boolean } | { type: "stop" }
  | { type: "hearing" } // the user is talking (interim speech): keep the silence timer from firing
  | { type: "ask"; core?: boolean } // core false: answered by Orbit itself (navigation), no stream to wait for
  | { type: "done" } | { type: "speaking" } | { type: "spoke" } | { type: "tick" };

export const IDLE: Conv = { phase: "idle", since: 0, asked: 0, persist: true, streams: 0 };

/** idle → listening → thinking → speaking → listening …; back to listening only once the answer is done AND spoken.
 *  Ends on stop, 30 s of silence, or the follow-up limit. */
export function convStep(s: Conv, e: ConvEvent, now: number): Conv {
  if (e.type === "start") return { phase: "listening", since: now, asked: 0, persist: e.persist, streams: 0 };
  if (s.phase === "idle") return s;
  switch (e.type) {
    case "stop": return IDLE;
    case "hearing": return s.phase === "listening" ? { ...s, since: now } : s;
    case "ask": return { ...s, phase: "thinking", since: now, asked: s.asked + 1, streams: s.streams + (e.core === false ? 0 : 1) };
    case "done": { // speaking: wait for "spoke"
      const t = { ...s, streams: Math.max(0, s.streams - 1) };
      return t.phase === "thinking" && !t.streams ? finished(t, now) : t;
    }
    case "speaking": return { ...s, phase: "speaking", since: now };
    case "spoke": return s.streams ? { ...s, phase: "thinking", since: now } : finished(s, now); // gap between streamed sentences
    case "tick":
      if (s.phase === "listening" && !s.persist && now - s.since >= SILENCE_MS) return IDLE;
      return s.phase === "thinking" && now - s.since >= THINK_MS ? { ...s, phase: "listening", since: now, streams: 0 } : s;
  }
}
const finished = (s: Conv, now: number): Conv => !s.persist && s.asked >= 2 ? IDLE : { ...s, phase: "listening", since: now };

const ORBIT = String.raw`(?:(?:hey|ok|okay)[\s,]+)?(?:orbit[\s,.!]+)?`;
const START = new RegExp(String.raw`^${ORBIT}(?:(?:let'?s|let us)\s+(?:just\s+)?(?:talk|chat|have a (?:chat|conversation))(?:\s+for a (?:bit|while))?|(?:start\s+|enter\s+|turn on\s+)?conversation mode(?:\s+on)?)\W*$`, "i");
const END = new RegExp(String.raw`^${ORBIT}(?:that'?s all|that is all|that'?s it|stop listening|good ?bye|bye|end (?:the )?conversation|(?:stop|exit|end) conversation mode|conversation mode off)(?:[\s,.]+(?:orbit|thanks|thank you|for now))*\W*$`, "i");
export const isConversationStart = (text: string) => START.test(text.trim());
export const isConversationEnd = (text: string) => END.test(text.trim());

const FILLER = new Set(["uh", "um", "umm", "uhm", "hmm", "mm", "er", "erm", "ah", "oh"]);
const words = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => !FILLER.has(w));
/** In conversation mode any real speech may cut ORBIT off — but never its own echo: not isEcho and ≥2 words it didn't say. */
export function conversationBargeIn(heard: string, spoken: string): boolean {
  if (isEcho(heard, spoken)) return false;
  const said = new Set(words(spoken));
  return words(heard).filter((w) => !said.has(w)).length >= 2;
}
