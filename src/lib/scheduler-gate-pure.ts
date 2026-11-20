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
