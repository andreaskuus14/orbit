import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CliSession } from "./claude";
import { orbitDataDir } from "./data-dir.ts";
import { allowOnceBook, type AllowOnceBook } from "./allow-once-pure.ts";
import { TICK_MAX, ackTrack, type Dead, capSessions, emptyTrack, liveSession, parseCursors, parseSessions, parseTracks, planTake, parseTaint, mergeTaint, type Cursors, type StoredSession, type TaintEntry, type Track } from "./durable-pure.ts";

// Small state that must survive a restart (review finding 6), in <ORBIT data dir>:
// core-sessions.json (CORE chat id → Claude CLI session) and event-cursors.json (events-feed consumer → last processed id).
// Both are rebuildable: an unreadable file starts empty (sessions fall back to stateless; consumers restart from "now").

const g = globalThis as unknown as { __orbitDurable?: { sessions?: Record<string, StoredSession>; taint?: Record<string, TaintEntry>; taintBroken?: boolean; cursors?: Cursors; tracks?: Record<string, Track>; fails?: Record<string, { at: string; error: string }>; chain: Promise<unknown> } };
const S = (g.__orbitDurable ??= { chain: Promise.resolve() });
const file = (name: string) => path.join(orbitDataDir(), name);

function load<T>(name: string, parse: (raw: unknown) => T): T {
  try { return parse(JSON.parse(readFileSync(file(name), "utf8"))); } catch { return parse(null); }
}

/** A durable-state write (this file's, checkpoints.json, a missions doc …) failed: kept until that same thing saves again, for
 *  Doctor and Needs-you. Without `e`: it saved. In memory only — the disk is what's failing; a restart re-notes on the next write. */
export function noteWrite(what: string, e?: unknown) {
  const f = (S.fails ??= {});
  if (e === undefined) delete f[what];
  else f[what] = { at: new Date().toISOString(), error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
}
export const writeFailures = () => Object.entries(S.fails ?? {}).map(([what, v]) => ({ what, ...v }));

/** Atomic write (tmp + rename), serialized so an older snapshot never lands after a newer one. A failed write rejects (callers
 *  must not treat it as saved) and drops the in-memory event state, so it is re-read from what the disk really holds. */
function save(name: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data);
  const p = S.chain.catch(() => {}).then(async () => {
    await mkdir(orbitDataDir(), { recursive: true });
    await writeFile(file(name) + ".tmp", text);
    await rename(file(name) + ".tmp", file(name));
  }).then(() => noteWrite(name), (e) => {
    console.error(`[orbit] could not save ${name}:`, e instanceof Error ? e.message : e);
    noteWrite(name, e);
    if (name.startsWith("event-")) { S.cursors = undefined; S.tracks = undefined; }
    throw e;
  });
  S.chain = p;
  return p;
}
const bg = (p: Promise<void>) => void p.catch(() => {}); // sessions are rebuildable: a failed save is logged + noted, not thrown

const sessions = () => (S.sessions ??= load("core-sessions.json", parseSessions));

/** CORE chat id → Claude CLI session, same get/set/delete shape core.ts used on its in-memory Map. */
export const coreSessionStore = {
  get(key: string): CliSession | undefined {
    const s = liveSession(sessions(), key, Date.now());
    return s ? { id: s.id, resume: true } : undefined;
  },
  set(key: string, s: CliSession) {
    S.sessions = capSessions({ ...sessions(), [key]: { id: s.id, at: Date.now() } });
    bg(save("core-sessions.json", S.sessions));
  },
  delete(key: string) {
    if (!(key in sessions())) return;
    delete S.sessions![key];
    bg(save("core-sessions.json", S.sessions));
  },
};

// core-taint.json: chats whose context held private data (C03). Apart from the session map: a dropped/expired session must not
// clear it (the stateless transcript still carries earlier answers). Never capped: an evicted chat would silently get web tools back.
// Fail closed: a file that exists but can't be read or parsed taints every chat and is left as is (not overwritten) for Doctor.
function taint() {
  if (S.taint) return S.taint;
  try { S.taint = parseTaint(JSON.parse(readFileSync(file("core-taint.json"), "utf8"))); }
  catch (e) { S.taint = {}; if ((e as NodeJS.ErrnoException).code !== "ENOENT") S.taintBroken = true; }
  return S.taint;
}
/** core-taint.json exists but is unreadable: every chat counts as tainted until it is fixed or deleted (Doctor shows it). */
export const taintBroken = () => (taint(), !!S.taintBroken);
export const coreTaintStore = {
  has: (key: string) => taintBroken() || key in taint(),
  /** The chat's taint entry; a broken file gives one of unknown kind for every chat (fail closed). */
  get: (key: string): TaintEntry | null => taintBroken() ? { id: "private", at: 0 } : taint()[key] ?? null,
  /** add: what this turn carried (kind + phrase hashes of the private / local-plugin text). Without it: unknown kind. */
  mark(key: string, add?: { kind: "private" | "local"; p: string[]; l: string[] }) {
    S.taint = { ...taint(), [key]: add ? mergeTaint(taint()[key], add, Date.now()) : { id: "private", at: Date.now() } };
    if (!S.taintBroken) bg(save("core-taint.json", S.taint)); // a failed save is noted; the mark stays in memory (fail closed)
  },
  delete(key: string) {
    if (!(key in taint())) return;
    delete S.taint![key];
    if (!S.taintBroken) bg(save("core-taint.json", S.taint)); // a failed save is noted; the mark stays in memory (fail closed)
  },
};

const cursors = () => (S.cursors ??= load("event-cursors.json", parseCursors));
export const getCursor = (consumer: string): number | undefined => cursors()[consumer];

/** Forget a consumer's cursor (nothing listens): it restarts from "now" instead of replaying when a listener comes back. */
export function clearCursor(consumer: string) {
  if (cursors()[consumer] === undefined) return;
  delete S.cursors![consumer];
  bg(save("event-cursors.json", S.cursors));
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

/** Dead letters (given up after crashing twice) of every consumer, until a Retry is acknowledged. */
export const deadEvents = (): (Dead & { consumer: string })[] => Object.entries(tracks()).flatMap(([consumer, t]) => (t.dead ?? []).map((d) => ({ ...d, consumer })));

/** The owner's Retry on a dead letter: the consumer's next claim hands it out once more (saved first; false = not a dead letter). */
export async function retryEvent(consumer: string, id: number): Promise<boolean> {
  const t = track(consumer);
  if (!t.dead?.some((d) => d.id === id)) return false;
  await setTrack(consumer, { ...t, retry: [...new Set([...(t.retry ?? []), id])] });
  return true;
}

export type EventRow = { id: number; user_id: string; type: string; payload: unknown; created_at?: string };

/** The consumer has acted on event `id` (or chose to ignore it). Track is saved first, so a crash or failed cursor write between the
 *  two only re-reads an already-acknowledged id, which `done` filters out. Rejects when either write fails (not acknowledged). */
export async function ackEvent(consumer: string, id: number, giveUp = false) {
  const r = ackTrack(getCursor(consumer) ?? 0, track(consumer), id, giveUp);
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
  const want = track(consumer).retry;
  if (want?.length) { // owner Retry: these exact events, once (they stay dead letters until acknowledged)
    const { data, error } = await sb.from("events").select("id, user_id, type, payload, created_at").in("id", want);
    if (error) throw error;
    await setTrack(consumer, { ...track(consumer), retry: [] });
    return ((data ?? []) as EventRow[]).sort((a, b) => a.id - b.id);
  }
  for (let page = 0; page < 50; page++) { // a long-downtime backlog is counted and passed in pages, not one tick per 200
    const cur = getCursor(consumer)!;
    const { data, error } = await sb.from("events").select("id, user_id, type, payload, created_at").gt("id", cur).in("type", types)
      .order("id").limit(TICK_MAX + track(consumer).done.length);
    if (error) throw error;
    const rows = (data ?? []) as EventRow[], plan = planTake(cur, rows, track(consumer), now);
    await setTrack(consumer, plan.track);
    for (const id of plan.drop) await ackEvent(consumer, id, true);
    if (plan.act.length || !plan.drop.length) return plan.act;
  }
  return [];
}

// Allow-once approvals (policy-pure allowOnceBook): in memory only, so a restart drops every offer and grant (fails closed).
const ag = globalThis as unknown as { __orbitAllowOnce?: AllowOnceBook };
export const allowOnce: AllowOnceBook = (ag.__orbitAllowOnce ??= allowOnceBook());

// taint-hash.key: per-install HMAC key for core-taint.json phrase hashes (phrase-hash-pure), created on first use, owner-only perms.
let hk: Buffer | undefined;
export function hashKey(): Buffer {
  if (hk) return hk;
  const f = file("taint-hash.key");
  try { hk = readFileSync(f); if (hk.length >= 32) return hk; } catch { /* first use */ }
  const k = randomBytes(32);
  try { mkdirSync(orbitDataDir(), { recursive: true }); writeFileSync(f, k, { mode: 0o600, flag: "wx" }); hk = k; }
  catch { hk = readFileSync(f); } // another process created it first (wx): use theirs; a read error throws (callers fail closed)
  return hk;
}
