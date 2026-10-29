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
export const TICK_MAX = 200; // events per tick; the rest carry to the next tick
export const REPLAY_WINDOW = 86_400_000; // 24 h: older missed events are stale, not worth acting on

export function parseCursors(raw: unknown): Cursors {
  const out: Cursors = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Number.isSafeInteger(v) && (v as number) >= 0) out[k] = v as number;
  return out;
}

/** Oldest created_at a restart replays from (ISO). */
export const replaySince = (now: number) => new Date(now - REPLAY_WINDOW).toISOString();

/** Rows read after `cursor` (any order, maybe overlapping or repeated) → the oldest `max` not yet processed, in order, plus the
 *  cursor to save BEFORE acting on them: it stops at the last one taken, so the remainder comes next tick
 *  (a crash mid-action skips that batch, never repeats it). */
export function takeNew<T extends { id: number }>(cursor: number, rows: T[], max = TICK_MAX): { fresh: T[]; next: number } {
  const fresh = [...new Map(rows.filter((r) => r.id > cursor).map((r) => [r.id, r])).values()].sort((a, b) => a.id - b.id).slice(0, max);
  return { fresh, next: fresh.length ? fresh[fresh.length - 1].id : cursor };
}

/** Per-consumer processing state (review: the cursor used to move before acting, so a crash skipped events).
 *  inflight: taken but not acknowledged (id → attempts); done: acknowledged ids above the cursor (out of order);
 *  skipped/gaveUp: counts surfaced in Doctor instead of silent drops. */
export type Track = { inflight: Record<string, number>; done: number[]; skipped: number; skippedAt?: string; gaveUp: number };
export const MAX_ATTEMPTS = 2; // the first try + one retry after a crash
export const emptyTrack = (): Track => ({ inflight: {}, done: [], skipped: 0, gaveUp: 0 });

export function parseTracks(raw: unknown): Record<string, Track> {
  const out: Record<string, Track> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const n = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const t = (v ?? {}) as Partial<Track>, inflight: Record<string, number> = {};
    for (const [id, a] of Object.entries(t.inflight && typeof t.inflight === "object" ? t.inflight : {})) if (/^\d+$/.test(id) && n(a)) inflight[id] = n(a);
    out[k] = { inflight, done: Array.isArray(t.done) ? t.done.filter((x) => Number.isSafeInteger(x)) : [], skipped: n(t.skipped), gaveUp: n(t.gaveUp),
      ...(typeof t.skippedAt === "string" ? { skippedAt: t.skippedAt } : {}) };
  }
  return out;
}

/** Rows read after `cursor` → what to act on now (oldest first, ≤ max, attempts bumped) and what to acknowledge unacted:
 *  rows older than the replay window (counted as skipped) and rows that already failed MAX_ATTEMPTS times (counted as gaveUp). */
export function planTake<T extends { id: number; created_at?: string }>(cursor: number, rows: T[], t: Track, now: number, max = TICK_MAX) {
  const { fresh } = takeNew(cursor, rows.filter((r) => !t.done.includes(r.id)), max);
  const since = replaySince(now), track: Track = { ...t, inflight: { ...t.inflight } }, act: T[] = [], drop: number[] = [];
  for (const r of fresh) {
    const tries = track.inflight[r.id] ?? 0;
    if (r.created_at && new Date(r.created_at).toISOString() < since) { drop.push(r.id); track.skipped++; track.skippedAt = new Date(now).toISOString(); }
    else if (tries >= MAX_ATTEMPTS) { drop.push(r.id); track.gaveUp++; }
    else { track.inflight[r.id] = tries + 1; act.push(r); }
  }
  return { act, drop, track };
}

/** Acknowledge `id`: the cursor moves past the contiguous acknowledged prefix (never past an unacknowledged event). */
export function ackTrack(cursor: number, t: Track, id: number): { cursor: number; track: Track } {
  const inflight = { ...t.inflight }; delete inflight[id];
  const done = [...new Set([...t.done, id])], open = Object.keys(inflight).map(Number);
  const low = open.length ? Math.min(...open) : Infinity;
  const next = Math.max(cursor, ...done.filter((d) => d < low));
  return { cursor: next, track: { ...t, inflight, done: done.filter((d) => d > next) } };
}
