// LIFE privacy helpers (pure; server, UI and tests). The journal never leaves LIFE's Journal tab: other screens get counts only,
// and while any LIFE screen is open ORBIT refuses desk screenshots (the shield, set by the client, expires on its own).

import type { LifeState } from "./life-pure.ts";

/** GET /api/life?lite=1: habits, reminders, focus and the timer, plus how many days have a journal entry. Built from an
 *  allowlist, so journal text, notes or any future field never slip in. */
export type LifeLite = Pick<LifeState, "today" | "habits" | "reminders" | "focus" | "work" | "timer" | "review"> & { journalDays: number };
export function liteLife(st: LifeState, journalDays: number): LifeLite {
  return {
    today: st.today, habits: st.habits, reminders: st.reminders, focus: st.focus, work: st.work, timer: st.timer, review: st.review,
    journalDays: Number.isFinite(journalDays) && journalDays > 0 ? Math.floor(journalDays) : 0,
  };
}

/** The client re-sets the shield every SHIELD_PING_MS while a LIFE screen is mounted; it lapses SHIELD_TTL_MS after the last ping
 *  (a closed tab or a crash can't leave it on forever, and a lost "off" never blocks screenshots for long). */
export const SHIELD_TTL_MS = 90_000, SHIELD_PING_MS = 30_000;
export const shieldUntil = (now: number) => now + SHIELD_TTL_MS;
export const shieldActive = (until: number | null | undefined, now: number) => typeof until === "number" && now < until;
/** Screenshot allowed only when the active window isn't private AND no LIFE screen is open in ORBIT. */
export const screenshotAllowed = (privateActive: boolean, shieldUntilMs: number | null | undefined, now: number) =>
  !privateActive && !shieldActive(shieldUntilMs, now);

/** Journal text kept on this PC when a save fails, so it's never lost. One draft per day. */
export const DRAFT_KEY = "orbit.life.journalDraft";
export type JournalDraft = { date: string; text: string };
export function parseDraft(raw: string | null | undefined, date: string): string | null {
  try {
    const d = JSON.parse(raw ?? "") as Partial<JournalDraft>;
    return d && d.date === date && typeof d.text === "string" && d.text ? d.text : null;
  } catch { return null; }
}
