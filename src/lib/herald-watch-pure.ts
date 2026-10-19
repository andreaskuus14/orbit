// Herald watch: pure rules for the background niche/trend inbox (<data dir>/herald-inbox.json) and its Windows toasts.
// Server timer: src/lib/herald-watch.ts. Read by GET /api/herald → Herald.tsx. Tested in tests/herald-watch.test.ts.
import type { HeraldCard } from "./herald-pure.ts";

export type InboxCard = HeraldCard & { at: number };
const MIN = 60_000, DAY = 24 * 60 * MIN;
export const INBOX_MAX = 30, INBOX_MS = 3 * DAY, AWAY_MS = 10 * MIN, MAX_TOASTS = 2;
export const AWAY_SUFFIX = " (found while you were away)";

const okCard = (c: unknown): c is InboxCard => {
  const x = c as InboxCard | null;
  return !!x && typeof x === "object" && typeof x.key === "string" && typeof x.kind === "string" && typeof x.title === "string"
    && typeof x.at === "number" && Array.isArray(x.actions);
};

/** File JSON → cards newer than 3 days (garbage dropped). */
export function parseInbox(j: unknown, now: number): InboxCard[] {
  return (Array.isArray(j) ? j : []).filter(okCard).filter((c) => now - c.at < INBOX_MS);
}

/** Appends cards whose key isn't in the inbox yet. Returns the new inbox (last 30, 3 days) and what was added. */
export function mergeInbox(old: unknown, cards: HeraldCard[], now: number): { inbox: InboxCard[]; added: InboxCard[] } {
  const inbox = parseInbox(old, now), keys = new Set(inbox.map((c) => c.key)), added: InboxCard[] = [];
  for (const c of cards) if (!keys.has(c.key)) { keys.add(c.key); added.push({ ...c, at: now }); }
  return { inbox: [...inbox, ...added].slice(-INBOX_MAX), added };
}

/** 23:00–07:59 local time: no toasts. */
export const quietHours = (now: number) => { const h = new Date(now).getHours(); return h >= 23 || h < 8; };

/** New cards worth a Windows toast: clippable ones (a "Clip it now" waits in ORBIT), at most 2, none in quiet hours. */
export const toastPicks = (added: HeraldCard[], now: number) =>
  quietHours(now) ? [] : added.filter((c) => c.actions.some((a) => a.clip)).slice(0, MAX_TOASTS);

/** Inbox cards as Herald cards; ones older than 10 min say they were found while he was away. */
export const inboxOffer = (cards: InboxCard[], now: number): HeraldCard[] =>
  cards.map(({ at, ...c }) => (now - at > AWAY_MS ? { ...c, body: (c.body ?? "") + AWAY_SUFFIX } : c));
