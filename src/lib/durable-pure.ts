// Durable state that used to live only in memory (review finding 6): CORE chat → Claude session ids, and event-feed cursors.

/** A stored CORE session: Claude CLI session id + last use (ms). Always resumable once stored. */
export type StoredSession = { id: string; at: number };
export const MAX_SESSIONS = 200;
export const SESSION_MAX_AGE = 30 * 86_400_000; // older CLI sessions are likely gone; a fresh one is cheaper than a failed resume

const okId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,80}$/.test(v);

/** Untrusted file → valid entries only (bad shapes dropped), newest MAX_SESSIONS kept. */
export function parseSessions(raw: unknown): Record<string, StoredSession> {
  const out: Record<string, StoredSession> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = v as Partial<StoredSession> | null;
    if (okId(k) && s && okId(s.id) && typeof s.at === "number" && Number.isFinite(s.at)) out[k] = { id: s.id, at: s.at };
  }
  return capSessions(out);
}

export function capSessions(m: Record<string, StoredSession>, max = MAX_SESSIONS): Record<string, StoredSession> {
  const keys = Object.keys(m);
  if (keys.length <= max) return m;
  return Object.fromEntries(keys.sort((a, b) => m[b].at - m[a].at).slice(0, max).map((k) => [k, m[k]]));
}

/** The session to resume for a chat, or null when missing or too old. */
export const liveSession = (m: Record<string, StoredSession>, key: string, now: number) => {
  const s = m[key];
  return s && now - s.at < SESSION_MAX_AGE ? s : null;
};

/** Event consumers' positions in the events feed: consumer name → last processed event id. Ids only grow, so the id is the dedupe. */
export type Cursors = Record<string, number>;
export const REPLAY_MAX = 500;
export const REPLAY_WINDOW = 86_400_000; // 24 h: older missed events are stale, not worth acting on

export function parseCursors(raw: unknown): Cursors {
  const out: Cursors = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Number.isSafeInteger(v) && (v as number) >= 0) out[k] = v as number;
  return out;
}

/** Oldest created_at a restart replays from (ISO). */
export const replaySince = (now: number) => new Date(now - REPLAY_WINDOW).toISOString();

/** Rows read after `cursor` (any order, maybe overlapping or repeated) → the ones not yet processed, oldest first, capped to the
 *  newest `max`, plus the cursor to save BEFORE acting on them (a crash mid-action then skips that batch, never repeats it). */
export function takeNew<T extends { id: number }>(cursor: number, rows: T[], max = REPLAY_MAX): { fresh: T[]; next: number } {
  const fresh = [...new Map(rows.filter((r) => r.id > cursor).map((r) => [r.id, r])).values()].sort((a, b) => a.id - b.id).slice(-max);
  return { fresh, next: fresh.length ? fresh[fresh.length - 1].id : cursor };
}
