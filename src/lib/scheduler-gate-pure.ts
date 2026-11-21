// Scheduler gates (efficiency pass, Nov 2026): skip database reads in the 60 s tick when their answer can't have changed.
// Pure; the IO and the env switch (ORBIT_SCHED_GATES=0 = every check reads the database every tick, as before) are in the callers.
import { dueSlots, type BriefingKind } from "./pure.ts";

/** A remembered "last run" read from the database, and when it was read. */
export type Remembered<T> = { value: T; at: number };

/** Cached last runs only move forward (runs are appended), so an older copy can only make a job look MORE due, never less.
 *  When even the old copy says "not due" the database would say the same: skip the read. Re-read at least every maxAgeMs
 *  (a deleted row, another process) and whenever the old copy says "due" (then the real rows decide). */
export const skipRead = <T>(r: Remembered<T> | undefined, now: number, maxAgeMs: number, notDue: (v: T) => boolean): boolean =>
  !!r && now - r.at < maxAgeMs && now >= r.at && notDue(r.value);

/** Briefings: the two reads (briefings + failed pulse runs) are needed only when some slot looks due with the remembered runs. */
export const briefingsSkip = (r: Remembered<Partial<Record<BriefingKind, string>>> | undefined, now: Date, maxAgeMs = 30 * 60_000) =>
  skipRead(r, now.getTime(), maxAgeMs, (last) => dueSlots(now, last).length === 0);

/** Proposals (every everyMs): skip while the remembered last run is younger than that. */
export const proposalsSkip = (r: Remembered<number> | undefined, now: number, everyMs: number, maxAgeMs = 30 * 60_000) =>
  skipRead(r, now, maxAgeMs, (last) => now - last < everyMs);

/** A slow sweep (approval expiry, the user list) runs at most every everyMs. */
export const sweepDue = (lastAt: number | undefined, now: number, everyMs: number) => lastAt === undefined || now - lastAt >= everyMs || now < lastAt;

// ── efficiency pass 2 ──
/** Events: one shared "newest event id" read per tick serves every consumer (automations, ntfy, rules). A consumer whose cursor
 *  is already at or past it, with nothing in flight or acknowledged-ahead and no owner Retry waiting, would read [] from the
 *  `id > cursor` query: skip that query. latest null (unknown) never skips. ORBIT_EVENTS_GATE=0 = always query. */
export const claimSkip = (cursor: number | undefined, latest: number | null, t: { done: number[]; inflight: Record<string, number>; retry?: number[] }) =>
  cursor !== undefined && latest !== null && latest <= cursor && !t.done.length && !Object.keys(t.inflight).length && !t.retry?.length;

/** missions / agent teams / goals resume passes: after a pass found nothing to resume, the next ones are skipped until something
 *  could have changed (an event was emitted or one of their writers ran, both in this process: dirtyAt), or maxAgeMs passed
 *  (another process, a row edited by hand). A pass that found rows always runs again next tick. ORBIT_RESUME_GATE=0 = every tick. */
export type IdleMark = { at: number; empty: boolean };
export const resumeSkip = (m: IdleMark | undefined, dirtyAt: number, now: number, maxAgeMs = 10 * 60_000) =>
  !!m && m.empty && dirtyAt <= m.at && now >= m.at && now - m.at < maxAgeMs;
