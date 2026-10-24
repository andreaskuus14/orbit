// "Today in a minute" evening capture (pure, tested in tests/evening.test.ts). IO: app/api/evening, UI: components/EveningCapture.tsx.
// The entry is LIFE data: a private journal memory, never part of CORE's always-in-context blocks.
import { SLOTS } from "./pure.ts";

/** A minute of typing fits easily. */
export const ENTRY_MAX = 1000;
const EVENING = SLOTS.find((s) => s.kind === "evening")!;
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Opens by itself once a day, from the evening briefing time (local) until midnight. lastShown: the local day it last opened. */
export function eveningDue(now: Date, lastShown: string | null): boolean {
  return now.getHours() * 60 + now.getMinutes() >= EVENING.hour * 60 + EVENING.minute && lastShown !== day(now);
}

/** The typed text → journal memory fields. The title carries only the date, so lists of titles (e.g. Pulse) never show the content. */
export function journalEntry(text: unknown, now: Date): { title: string; content: string } | { error: string } {
  if (typeof text !== "string") return { error: "Write a line about today." };
  const content = text.replace(/\r\n?/g, "\n").trim();
  if (!content) return { error: "Write a line about today." };
  if (content.length > ENTRY_MAX) return { error: `Keep it under ${ENTRY_MAX} characters.` };
  return { title: `Today in a minute · ${day(now)}`, content };
}

export { day as eveningDay };
