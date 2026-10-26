// Car mode on the phone remote: what ORBIT reads aloud while he drives or walks. Pure, tested in tests/car-mode.test.ts.
// Titles only, never message text, recipients or amounts; nothing is approved here (approvals stay on screen, "review later").
import { speakable, takeSentences } from "./call-pure.ts";
import type { ApprovalKind } from "./remote-web-pure.ts";

export type CarItem = { id: string; kind: ApprovalKind; title: string };
export const MAX_READ = 5; // more than this is "and N more": he can't take in a long list by ear
export const MAX_CAR_CHARS = 900; // ≈ 60 s spoken
export const LATER_KEY = "orbit.remote.later"; // localStorage: ids read aloud in car mode, flagged for on-screen review

const RANK: Record<ApprovalKind, number> = { send: 0, nego: 1, spend: 2, clip: 3 }; // people waiting on a reply first, clips last
const NOUN: Record<ApprovalKind, string> = { send: "an email", nego: "a negotiation reply", spend: "a Higgsfield spend", clip: "a clip" };
const WORDS = ["One", "Two", "Three", "Four", "Five"];

/** Messages to people first, then spends, then clips; the list's own order within a kind. */
export const carOrder = <T extends CarItem>(items: readonly T[]): T[] => items.map((it, i) => ({ it, i }))
  .sort((a, b) => RANK[a.it.kind] - RANK[b.it.kind] || a.i - b.i).map((x) => x.it);

/** Text trimmed to whole sentences that fit `max` characters (one long sentence is cut at a word). */
export function trimSpeech(text: string, max = MAX_CAR_CHARS): string {
  const t = speakable(text);
  if (t.length <= max) return t;
  let out = "";
  for (const s of takeSentences(t, true).done) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** "Read me what's waiting": the words, and the ids it read (to mark "review later"). */
export function waitingSpeech(items: readonly CarItem[]): { text: string; ids: string[] } {
  if (!items.length) return { text: "Nothing's waiting for you.", ids: [] };
  const read = carOrder(items).slice(0, MAX_READ);
  const lines = read.map((it, i) => `${WORDS[i]}: ${NOUN[it.kind]}, ${trimSpeech(it.title, 80).replace(/[.!?…]+$/, "")}.`);
  const more = items.length - read.length;
  const text = [
    items.length === 1 ? "One thing is waiting." : `${items.length} things are waiting.`,
    ...lines,
    ...(more ? [`And ${more} more.`] : []),
    "I've marked them to review later. Approve them on screen when you've stopped.",
  ].join(" ");
  return { text, ids: read.map((it) => it.id) };
}

/** The phone's brief reply ({off} | {greeting, spoken}) as words to say. */
export function briefSpeech(b: { off?: boolean; greeting?: string; spoken?: string } | null): string {
  if (!b) return "I couldn't get the brief. Check ORBIT on the PC.";
  if (b.off) return "The morning brief is turned off in Autonomy settings.";
  return trimSpeech(b.spoken?.trim() || `${b.greeting ?? "Hi"}. Nothing needs you right now.`);
}

/** Speakable chunks for speechSynthesis (iOS drops very long utterances). */
export const speechParts = (text: string) => takeSentences(text, true).done;

/** The "review later" set after a read: new ids added, ids no longer waiting dropped. */
export const markLater = (prev: readonly string[], read: readonly string[], waiting: readonly string[]) =>
  [...new Set([...prev, ...read])].filter((id) => waiting.includes(id));
