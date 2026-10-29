// Durable state that used to live only in memory (review finding 6): CORE chat → Claude session ids, and event-feed cursors.

/** A stored CORE session: Claude CLI session id + last use (ms). Always resumable once stored. */
export type StoredSession = { id: string; at: number };
export const MAX_SESSIONS = 200;
export const SESSION_MAX_AGE = 30 * 86_400_000; // older CLI sessions are likely gone; a fresh one is cheaper than a failed resume

const okId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,80}$/.test(v);

/** Untrusted file → valid entries only (bad shapes dropped), newest MAX_SESSIONS kept. */
export function parseSessions(raw: unknown, max = MAX_SESSIONS): Record<string, StoredSession> {
  const out: Record<string, StoredSession> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = v as Partial<StoredSession> | null;
    if (okId(k) && s && okId(s.id) && typeof s.at === "number" && Number.isFinite(s.at)) out[k] = { id: s.id, at: s.at };
  }
  return capSessions(out, max);
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
 *  skipped/gaveUp: counts surfaced in Doctor instead of silent drops (skippedAt: the last time either grew). */
export type Track = { inflight: Record<string, number>; done: number[]; skipped: number; skippedAt?: string; gaveUp: number; dead?: Dead[]; retry?: number[] };
/** A given-up event (dead letter), kept until the owner's Retry acknowledges it; retry: dead ids to hand out once more. */
export type Dead = { id: number; summary: string; at: string };
const MAX_DEAD = 50;
/** One line naming an event for the owner: its type and, when present, the title/kind from its payload. */
export const eventSummary = (r: { type?: string; payload?: unknown }) => {
  const p = (r.payload ?? {}) as Record<string, unknown>, what = [p.title, p.kind, p.to].find((v) => typeof v === "string" && v);
  return `${r.type ?? "event"}${what ? `: ${String(what).slice(0, 80)}` : ""}`;
};
export const MAX_ATTEMPTS = 2; // the first try + one retry after a crash
export const emptyTrack = (): Track => ({ inflight: {}, done: [], skipped: 0, gaveUp: 0 });

export function parseTracks(raw: unknown): Record<string, Track> {
  const out: Record<string, Track> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const n = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const t = (v ?? {}) as Partial<Track>, inflight: Record<string, number> = {};
    for (const [id, a] of Object.entries(t.inflight && typeof t.inflight === "object" ? t.inflight : {})) if (/^\d+$/.test(id) && n(a)) inflight[id] = n(a);
    const dead = (Array.isArray(t.dead) ? t.dead : []).filter((d) => d && Number.isSafeInteger(d.id) && typeof d.summary === "string" && typeof d.at === "string");
    out[k] = { inflight, done: Array.isArray(t.done) ? t.done.filter((x) => Number.isSafeInteger(x)) : [], skipped: n(t.skipped), gaveUp: n(t.gaveUp),
      ...(typeof t.skippedAt === "string" ? { skippedAt: t.skippedAt } : {}),
      ...(dead.length ? { dead } : {}), ...(Array.isArray(t.retry) ? { retry: t.retry.filter((x) => Number.isSafeInteger(x)) } : {}) };
  }
  return out;
}

/** Rows read after `cursor` → what to act on now (oldest first, ≤ max, attempts bumped) and what to acknowledge unacted:
 *  rows older than the replay window (counted as skipped) and rows that already failed MAX_ATTEMPTS times (counted as gaveUp). */
export function planTake<T extends { id: number; created_at?: string; type?: string; payload?: unknown }>(cursor: number, rows: T[], t: Track, now: number, max = TICK_MAX) {
  const { fresh } = takeNew(cursor, rows.filter((r) => !t.done.includes(r.id)), max);
  const since = replaySince(now), track: Track = { ...t, inflight: { ...t.inflight } }, act: T[] = [], drop: number[] = [];
  for (const r of fresh) {
    const tries = track.inflight[r.id] ?? 0;
    if (r.created_at && new Date(r.created_at).toISOString() < since) { drop.push(r.id); track.skipped++; track.skippedAt = new Date(now).toISOString(); }
    else if (tries >= MAX_ATTEMPTS) {
      drop.push(r.id); track.gaveUp++; track.skippedAt = new Date(now).toISOString();
      track.dead = [...(track.dead ?? []).filter((d) => d.id !== r.id), { id: r.id, summary: eventSummary(r), at: track.skippedAt }].slice(-MAX_DEAD);
    }
    else { track.inflight[r.id] = tries + 1; act.push(r); }
  }
  return { act, drop, track };
}

/** Acknowledge `id`: the cursor moves past the contiguous acknowledged prefix (never past an unacknowledged event).
 *  `done` is pruned against the SAVED cursor, not the new one: the track is written before the cursor, so if the cursor write
 *  fails the ids it would have covered are still filtered out. giveUp: acknowledged unacted, so its dead letter stays. */
export function ackTrack(cursor: number, t: Track, id: number, giveUp = false): { cursor: number; track: Track } {
  const inflight = { ...t.inflight }; delete inflight[id];
  const done = [...new Set([...t.done, id])], open = Object.keys(inflight).map(Number);
  const low = open.length ? Math.min(...open) : Infinity;
  const next = Math.max(cursor, ...done.filter((d) => d < low));
  const dead = giveUp ? t.dead : t.dead?.filter((d) => d.id !== id); // a retried dead letter leaves the list only once it is acknowledged
  return { cursor: next, track: { ...t, inflight, done: done.filter((d) => d > cursor), ...(dead ? { dead } : {}) } };
}

/** Doctor's "Saved state & events" check: a failed durable write is a fail (work may be redone or not recorded until fixed);
 *  dead letters are a warn, each with a Retry button (POST /api/doctor {retry: "consumer:id"}). */
export function durableCheck(fails: { what: string; error: string; at: string }[], dead: (Dead & { consumer: string })[]) {
  const retry = dead.map((d) => ({ key: `${d.consumer}:${d.id}`, label: `${d.summary} (${d.consumer})` }));
  if (fails.length) return { status: "fail" as const, detail: `Could not save ${fails.map((f) => `${f.what} (${f.error})`).join("; ")}. Until it saves, that progress isn't durable: events stay unacknowledged and get retried after a restart.`,
    fix: "Free disk space or fix the ORBIT data folder's permissions; ORBIT retries by itself on the next write.", retry };
  if (dead.length) return { status: "warn" as const, detail: `${dead.length} event${dead.length === 1 ? "" : "s"} given up after crashing twice: ${retry.slice(0, 3).map((r) => r.label).join("; ")}`,
    fix: "Press Retry to hand one to its consumer once more (it won't create a duplicate).", retry };
  return { status: "ok" as const, detail: "Event progress and checkpoints are saving normally", retry };
}
