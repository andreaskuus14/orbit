// Brief mode (idea from the "I have ADHD" agent skill): CORE answers next-action-first, numbers multi-step instructions and
// drops filler. Stored as a marker at the start of the profile's "how CORE should talk to you" text, so it needs no schema
// change and travels with the profile. Tests: tests/brief-mode.test.ts.
export const BRIEF_MARK = "[brief]";
export const isBrief = (communication: string | null | undefined) => (communication ?? "").trimStart().toLowerCase().startsWith(BRIEF_MARK);
/** The communication text with brief mode switched on or off (the owner's own words are kept). */
export const withBrief = (communication: string, on: boolean) => {
  const rest = isBrief(communication) ? communication.trimStart().slice(BRIEF_MARK.length).trimStart() : communication;
  return on ? `${BRIEF_MARK} ${rest}`.trimEnd() : rest;
};
/** The owner's text without the marker, for the profile facts. */
export const communicationText = (communication: string) => withBrief(communication, false);

export const BRIEF_RULES = `- BRIEF MODE (the user switched it on): put the answer or the next action in the first sentence. For 3 or more steps use a numbered list, one action per line. No filler openers ("Great question", "Sure", "Certainly", "I'd be happy to"), no recap of the question, no closing offers. Keep it scannable: short sentences, details only when they change what he does.`;

const FILLER = /^(?:great question|good question|sure[,!. ]|certainly|absolutely|of course|i'd be happy to|i would be happy to|happy to help|hea küsimus|muidugi|kindlasti)/i;
/** What a brief-mode reply got wrong ([] = fine): a filler opener, or 3+ steps written as prose/bullets instead of numbers. */
export function briefProblems(reply: string): string[] {
  const out: string[] = [], text = reply.trim();
  if (FILLER.test(text)) out.push("starts with filler");
  const bullets = text.split("\n").filter((l) => /^\s*[-*•]\s+/.test(l)).length;
  const numbered = text.split("\n").filter((l) => /^\s*\d+[.)]\s+/.test(l)).length;
  const firstThen = /\b(first|then|next|after that|finally)\b/gi, cues = (text.match(firstThen) ?? []).length;
  if (numbered < 3 && (bullets >= 3 || cues >= 3)) out.push("3+ steps not numbered");
  return out;
}

const BRIEF_ON = /^(?:(?:core|orbit)[,: ]+)?(?:be brief|brief mode(?: on)?|lühidalt|ole lühike|lühirežiim(?: sisse)?)$/;
const BRIEF_OFF = /^(?:(?:core|orbit)[,: ]+)?(?:normal|normal mode|brief mode off|tavaline|tavarežiim|lühirežiim välja)$/;
/** A typed or spoken "be brief" / "lühidalt" (on) or "normal" (off) as the whole message; null for anything else. */
export function briefCommand(text: string): { on: boolean; et: boolean } | null {
  const t = text.trim().toLowerCase().replace(/[\s.!]+$/, "").replace(/\s+/g, " ");
  const on = BRIEF_ON.test(t) ? true : BRIEF_OFF.test(t) ? false : null;
  return on === null ? null : { on, et: /lühi|tava/.test(t) };
}
export const briefReply = (on: boolean, et: boolean) =>
  et ? (on ? "Lühirežiim on sees. Ütle \"tavaline\", et välja lülitada." : "Lühirežiim on väljas.")
     : (on ? "Brief mode is on. Say \"normal\" to turn it off." : "Brief mode is off.");
