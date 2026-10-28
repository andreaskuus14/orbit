import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CliSession } from "./claude";
import { orbitDataDir } from "./data-dir.ts";
import { REPLAY_MAX, capSessions, liveSession, parseCursors, parseSessions, replaySince, takeNew, type Cursors, type StoredSession } from "./durable-pure.ts";

// Small state that must survive a restart (review finding 6), in <ORBIT data dir>:
// core-sessions.json (CORE chat id → Claude CLI session) and event-cursors.json (events-feed consumer → last processed id).
// Both are rebuildable: an unreadable file starts empty (sessions fall back to stateless; consumers restart from "now").

const g = globalThis as unknown as { __orbitDurable?: { sessions?: Record<string, StoredSession>; cursors?: Cursors; chain: Promise<unknown> } };
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

export type EventRow = { id: number; user_id: string; type: string; payload: unknown };

/** New events of `types` for one consumer, each returned once across restarts. First run ever starts at the newest event;
 *  after downtime it replays from the saved cursor, but only the last 24 h and the newest REPLAY_MAX of them.
 *  The cursor is saved before the caller acts, so a crash mid-batch skips those events rather than running them twice. */
export async function claimEvents(sb: SupabaseClient, consumer: string, types: string[], now = Date.now()): Promise<EventRow[]> {
  const cur = getCursor(consumer);
  if (cur === undefined) {
    const { data, error } = await sb.from("events").select("id").order("id", { ascending: false }).limit(1);
    if (error) throw error; // a failed read must not start the cursor at 0 and replay every past event
    await setCursor(consumer, data?.[0]?.id ?? 0);
    return [];
  }
  // Newest first so the cap keeps the most recent; takeNew puts them back in order.
  const { data, error } = await sb.from("events").select("id, user_id, type, payload").gt("id", cur).in("type", types)
    .gte("created_at", replaySince(now)).order("id", { ascending: false }).limit(REPLAY_MAX);
  if (error) throw error;
  const { fresh, next } = takeNew(cur, (data ?? []) as EventRow[]);
  if (next !== cur) await setCursor(consumer, next);
  return fresh;
}
