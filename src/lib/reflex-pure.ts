// CORE reflexes: whole-message greetings, thanks and clock questions that need no memories, tools or world context.
// Pure (no imports): tested in tests/reflex.test.ts. Anything else returns null and takes CORE's full path.
// Navigation ("open studio") never reaches the server: the chat runs parseNavCommand (nav-pure.ts) before sending.

export type Reflex = "greet" | "thanks" | "time" | "date";

const END = String.raw`[\s,!.?…:)(\p{Extended_Pictographic}\u{FE0F}]*$`;
const WHO = String.raw`(?:[\s,]+(?:core|orbit|there|buddy|mate|friend))?`;
const GREET = new RegExp(String.raw`^(?:hi|hii+|hello|hey+|hiya|howdy|yo|sup|tere|hei|moi|good (?:afternoon|evening|day))${WHO}(?:[\s,!.]+(?:how are you(?: doing)?(?: today)?|how's it going|what's up|kuidas läheb))?${END}`, "iu");
const THANKS = new RegExp(String.raw`^(?:(?:ok(?:ay)?|great|perfect|cool|nice|awesome)[\s,!.]+)?(?:thanks|thank you|thx|ty|cheers|aitäh|tänan|tänud)(?: (?:a lot|so much|very much|again))?${WHO}${END}`, "iu");
const TIME = new RegExp(String.raw`^(?:what(?:'s| is) the time|what time is it|whats the time|time|current time|mis kell on|kell)(?: (?:now|right now))?${END}`, "iu");
const DATE = new RegExp(String.raw`^(?:what(?:'s| is) (?:the date|today's date|the date today)|whats the date|what day is (?:it|today)|which day is it|today's date|mis päev täna on)(?: today)?${END}`, "iu");

/** The reflex for a whole message, or null. Long or multi-line text is never a reflex. */
export function classifyReflex(text: string): Reflex | null {
  const t = text.trim().replace(/[’`]/g, "'");
  if (!t || t.length > 60 || t.includes("\n")) return null;
  return TIME.test(t) ? "time" : DATE.test(t) ? "date" : THANKS.test(t) ? "thanks" : GREET.test(t) ? "greet" : null;
}

/** The answer to a clock reflex, from the server's clock (ORBIT runs on the owner's PC, so this is his local time). */
export function clockReply(kind: "time" | "date", d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return kind === "time"
    ? `It's ${pad(d.getHours())}:${pad(d.getMinutes())}.`
    : `Today is ${d.toLocaleDateString("en-GB", { weekday: "long" })}, ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "long" })} ${d.getFullYear()}.`;
}

/** Greetings and thanks answered locally: a model call costs ~5 s on Windows for one sentence. Estonian in, Estonian out. */
export function smallTalkReply(kind: "greet" | "thanks", text: string, ongoing: boolean): string {
  const et = /\b(?:tere|aitäh|tänan|tänud|kuidas läheb)\b/iu.test(text);
  if (kind === "thanks") return et ? "Pole tänu!" : "Anytime.";
  if (ongoing) return et ? "Jah? Mis edasi?" : "Yes? What next?";
  return et ? "Tere! Mis teeme?" : "Hey. What are we working on?";
}
