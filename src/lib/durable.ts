import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CliSession } from "./claude";
import { orbitDataDir } from "./data-dir.ts";
import { TICK_MAX, ackTrack, capSessions, emptyTrack, liveSession, parseCursors, parseSessions, parseTracks, planTake, type Cursors, type StoredSession, type Track } from "./durable-pure.ts";

// Small state that must survive a restart (review finding 6), in <ORBIT data dir>:
// core-sessions.json (CORE chat id → Claude CLI session) and event-cursors.json (events-feed consumer → last processed id).
// Both are rebuildable: an unreadable file starts empty (sessions fall back to stateless; consumers restart from "now").

const g = globalThis as unknown as { __orbitDurable?: { sessions?: Record<string, StoredSession>; taint?: Record<string, StoredSession>; cursors?: Cursors; tracks?: Record<string, Track>; chain: Promise<unknown> } };
const S = (g.__orbitDurable ??= { chain: Promise.resolve() });
const file = (name: string) => path.join(orbitDataDir(), name);

function load<T>(name: string, parse: (raw: unknown) => T): T {
  try { return parse(JSON.parse(readFileSync(file(name), "utf8"))); } catch { return parse(null); }
}

/** Atomic write (tmp + rename), serialized so an older snapshot never lands after a newer one. A failed write is logged, not thrown. */
function save(name: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data);
  const p = S.chain.catch(() => {}).then(async () => {
    await mkdir(orbitDataDir(), { recursive: true });
    await writeFile(file(name) + ".tmp", text);
    await rename(file(name) + ".tmp", file(name));
  }).catch((e) => console.error(`[orbit] could not save ${name}:`, e instanceof Error ? e.message : e));
  S.chain = p;
  return p;
}

const sessions = () => (S.sessions ??= load("core-sessions.json", parseSessions));

/** CORE chat id → Claude CLI session, same get/set/delete shape core.ts used on its in-memory Map. */
export const coreSessionStore = {
  get(key: string): CliSession | undefined {
    const s = liveSession(sessions(), key, Date.now());
    return s ? { id: s.id, resume: true } : undefined;
  },
  set(key: string, s: CliSession) {
    S.sessions = capSessions({ ...sessions(), [key]: { id: s.id, at: Date.now() } });
    void save("core-sessions.json", S.sessions);
  },
  delete(key: string) {
    if (!(key in sessions())) return;
    delete S.sessions![key];
    void save("core-sessions.json", S.sessions);
  },
};

// core-taint.json: chats whose context held private data (C03). Apart from the session map: a dropped/expired session must not
// clear it (the stateless transcript still carries earlier answers). shortcut: capped like sessions (newest 200), raise if chats grow.
const taint = () => (S.taint ??= load("core-taint.json", parseSessions));
export const coreTaintStore = {
  has: (key: string) => key in taint(),
  mark(key: string) {
    S.taint = capSessions({ ...taint(), [key]: { id: "private", at: Date.now() } });
    void save("core-taint.json", S.taint);
  },
  delete(key: string) {
    if (!(key in taint())) return;
    delete S.taint![key];
    void save("core-taint.json", S.taint);
  },
};

const cursors = () => (S.cursors ??= load("event-cursors.json", parseCursors));
export const getCursor = (consumer: string): number | undefined => cursors()[consumer];

/** Forget a consumer's cursor (nothing listens): it restarts from "now" instead of replaying when a listener comes back. */
export function clearCursor(consumer: string) {
  if (cursors()[consumer] === undefined) return;
  delete S.cursors![consumer];
  void save("event-cursors.json", S.cursors);
}

async function setCursor(consumer: string, id: number) {
  S.cursors = { ...cursors(), [consumer]: id };
  await save("event-cursors.json", S.cursors);
}

// event-track.json: per consumer, events taken but not yet acknowledged, plus skipped/given-up counts for Doctor.
const tracks = () => (S.tracks ??= load("event-track.json", parseTracks));
const track = (consumer: string) => tracks()[consumer] ?? emptyTrack();
async function setTrack(consumer: string, t: Track) {
  S.tracks = { ...tracks(), [consumer]: t };
  await save("event-track.json", S.tracks);
}
/** Skipped (older than the replay window) and given-up (crashed twice) counts per consumer, for Doctor. */
export const eventGaps = () => Object.entries(tracks()).map(([consumer, t]) => ({ consumer, skipped: t.skipped, skippedAt: t.skippedAt, gaveUp: t.gaveUp }));

export type EventRow = { id: number; user_id: string; type: string; payload: unknown; created_at?: string };

/** The consumer has acted on event `id` (or chose to ignore it). Track is saved first, so a crash between the two writes only re-reads
 *  an already-acknowledged id, which `done` filters out. */
export async function ackEvent(consumer: string, id: number) {
  const r = ackTrack(getCursor(consumer) ?? 0, track(consumer), id);
  await setTrack(consumer, r.track);
  if (r.cursor !== getCursor(consumer)) await setCursor(consumer, r.cursor);
}

/** Events of `types` for one consumer, oldest first, at most TICK_MAX. Each is marked "processing" (saved) before it is returned;
 *  the caller acts, then calls ackEvent. One left unacknowledged by a crash comes back once more (its action must be idempotent on
 *  `event:<consumer>:<id>`); a second crash gives up on it. First run ever starts at the newest event. Events older than 24 h are
 *  not acted on but counted (eventGaps → Doctor). */
export async function claimEvents(sb: SupabaseClient, consumer: string, types: string[], now = Date.now()): Promise<EventRow[]> {
  if (getCursor(consumer) === undefined) {
    const { data, error } = await sb.from("events").select("id").order("id", { ascending: false }).limit(1);
    if (error) throw error; // a failed read must not start the cursor at 0 and replay every past event
    await setCursor(consumer, data?.[0]?.id ?? 0);
    return [];
  }
  for (let page = 0; page < 50; page++) { // a long-downtime backlog is counted and passed in pages, not one tick per 200
    const cur = getCursor(consumer)!;
    const { data, error } = await sb.from("events").select("id, user_id, type, payload, created_at").gt("id", cur).in("type", types)
      .order("id").limit(TICK_MAX + track(consumer).done.length);
    if (error) throw error;
    const rows = (data ?? []) as EventRow[], plan = planTake(cur, rows, track(consumer), now);
    await setTrack(consumer, plan.track);
    for (const id of plan.drop) await ackEvent(consumer, id);
    if (plan.act.length || !plan.drop.length) return plan.act;
  }
  return [];
}
