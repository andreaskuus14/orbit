// Runs that a restart or an outage cut off are not real problems (owner, 22 Nov: the laptop restarted ORBIT ~16 times for live
// updates and lost the internet for 40 min; Daily business loop, Morning Brief and research tasks were then left "failed" and drew a
// red ring around AGENTS). Pure rules; IO: agents.ts reclaimInterrupted (restart) and net-retry.ts (no internet). Tests:
// tests/run-recovery.test.ts.
//  1. A task a restart cut off goes back in the queue by itself, once, when re-running it repeats nothing (no approved or attempted
//     action, no sub-tasks). Otherwise, or the second time, it stays failed as "Interrupted" with the owner's Retry.
//  2. A failed run stops counting as a problem once a later run of the same automation finished, or once it is older than
//     PROBLEM_MAX_AGE_MS. It stays in OPERATIONS (the task list and its history); it only leaves Needs you and the galaxy.

/** A failure older than this is history, not today's state. */
export const PROBLEM_MAX_AGE_MS = 24 * 3_600_000;
/** How long a "retried once after a restart" mark is kept (a task older than this is never re-queued anyway). */
export const RETRY_MARK_MS = 7 * 86_400_000;

export type CutOff = { id: string; title: string; pending?: { status?: string }[] | null; children?: number };

/** May a task the restart cut off start again by itself? Only once per task (retried: ids already re-queued after a restart, kept
 *  across restarts), only when nothing in it was approved, attempted or handed to a sub-task (a re-run then repeats nothing), and
 *  never for teams or goal steps (they resume their own steps). */
export function restartRerun(t: CutOff, retried: ReadonlySet<string>): boolean {
  if (retried.has(t.id) || t.children) return false;
  if (/^(?:Team: |Goal step )/.test(t.title ?? "")) return false;
  return (Array.isArray(t.pending) ? t.pending : []).every((p) => p?.status === "pending");
}

/** The queue patch for such a re-run: the same reset as the owner's Retry. */
export const requeuePatch = () => ({ status: "queued" as const, error: null, result: null, trace: [], pending: [], started_at: null, finished_at: null });

/** The stored marks, minus the ones too old to matter; bad entries are dropped. */
export function pruneMarks(marks: unknown, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!marks || typeof marks !== "object") return out;
  for (const [id, at] of Object.entries(marks as Record<string, unknown>))
    if (typeof at === "number" && Number.isFinite(at) && at <= now && now - at < RETRY_MARK_MS) out[id] = at;
  return out;
}

/** One failed run, as Needs you sees it. automation: its automation id; superseded: a later run of it finished. */
export type FailedRun = { id: string; at?: string; automation?: string; superseded?: boolean };

/** The failed runs that still count as a problem: not superseded, not older than PROBLEM_MAX_AGE_MS (unknown time: counts), and
 *  one per automation (its newest failure: two failed Morning Briefs are one problem). Order is kept. */
export function liveFailures<T extends FailedRun>(runs: readonly T[], now: number): T[] {
  const ms = (r: T) => Date.parse(r.at ?? "");
  const recent = runs.filter((r) => !r.superseded && !(Number.isFinite(ms(r)) && now - ms(r) > PROBLEM_MAX_AGE_MS));
  const newest = new Map<string, T>();
  for (const r of recent) if (r.automation) { const o = newest.get(r.automation); if (!o || (ms(r) || 0) > (ms(o) || 0)) newest.set(r.automation, r); }
  return recent.filter((r) => !r.automation || newest.get(r.automation) === r);
}

/** SYSTEM → Automations "Needs attention": an enabled automation whose latest run failed, within the last PROBLEM_MAX_AGE_MS.
 *  A later run (it is then the latest) or age clears it. */
export function lastRunFailing(last: { status?: string; finished_at?: string | null; created_at?: string } | null | undefined, now: number): boolean {
  if (last?.status !== "failed") return false;
  const at = Date.parse(last.finished_at ?? last.created_at ?? "");
  return !(Number.isFinite(at) && now - at > PROBLEM_MAX_AGE_MS);
}
