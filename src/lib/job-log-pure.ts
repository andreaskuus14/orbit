// Durable job step log (research 4.7, roadmap Phase 2) for agent-task jobs and the night shift — not CORE chat turns. Pure; tested in
// tests/job-log.test.ts; IO: job-log.ts (<ORBIT data dir>/job-steps.json + leases/). Each step is recorded once under a stable key
// with its result, so a restarted job replays finished steps from the log and resumes at the first unfinished one. A step with an
// outside effect gets its idempotency key written BEFORE the call; after a crash the retry carries the same key, so the callee
// (e.g. a row insert that looks the key up first) can tell it already happened. A lease keeps two runners off the same job.
import { createHash } from "node:crypto";

export type StepRec = { status: "started" | "done" | "failed"; at: string; result?: unknown; idem?: string; error?: string; tries: number };
export type JobRec = { steps: Record<string, StepRec>; updatedAt: string };
export type JobLog = Record<string, JobRec>;
export type Lease = { owner: string; until: number };

export const MAX_JOBS = 300; // oldest-updated jobs drop first
export const JOB_MAX_AGE = 14 * 86_400_000;
export const MAX_RESULT = 4000; // chars of JSON per step result: the log is a memo, not an artifact store
export const MAX_TRIES = 3; // a step that crashed this many times fails instead of looping
const okKey = (k: string) => /^[\w:./-]{1,160}$/.test(k);

export function parseJobLog(raw: unknown, now = Date.now()): JobLog {
  const out: JobLog = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, j] of Object.entries(raw as Record<string, unknown>)) {
    const r = j as Partial<JobRec> | null;
    if (!okKey(id) || !r || typeof r.updatedAt !== "string" || !r.steps || typeof r.steps !== "object") continue;
    if (now - Date.parse(r.updatedAt) > JOB_MAX_AGE) continue;
    const steps: Record<string, StepRec> = {};
    for (const [k, s] of Object.entries(r.steps)) if (okKey(k) && s && ["started", "done", "failed"].includes(s.status) && typeof s.at === "string") steps[k] = { ...s, tries: Number.isSafeInteger(s.tries) ? s.tries : 1 };
    out[id] = { steps, updatedAt: r.updatedAt };
  }
  const ids = Object.keys(out);
  return ids.length <= MAX_JOBS ? out : Object.fromEntries(ids.sort((a, b) => out[b].updatedAt.localeCompare(out[a].updatedAt)).slice(0, MAX_JOBS).map((k) => [k, out[k]]));
}

/** Stable idempotency key for one effect step: the same job + step always gives the same key, across restarts. */
export const idemKey = (job: string, step: string) => `orbit-${createHash("sha256").update(`${job}\n${step}`).digest("hex").slice(0, 24)}`;

/** What to do with step `key` now: replay a finished result, refuse after too many crashes, or run (attempt n, same idem key). */
export function planStep(log: JobLog, job: string, key: string, effect: boolean):
  { do: "replay"; result: unknown } | { do: "give-up"; error: string } | { do: "run"; tries: number; idem?: string; retry: boolean } {
  const s = log[job]?.steps[key];
  if (s?.status === "done") return { do: "replay", result: s.result };
  const tries = (s?.tries ?? 0) + 1;
  if (s && tries > MAX_TRIES) return { do: "give-up", error: s.error ?? `step ${key} crashed ${s.tries} times` };
  return { do: "run", tries, retry: !!s, ...(effect ? { idem: s?.idem ?? idemKey(job, key) } : {}) };
}

/** Log after a step started / finished / failed (mutates and returns the log). Results too big for the memo are dropped (the step
 *  still counts as done; a replay then gets undefined, so keep results to ids and short labels). */
export function recordStep(log: JobLog, job: string, key: string, rec: Omit<StepRec, "at">, now: number): JobLog {
  const at = new Date(now).toISOString(), j = (log[job] ??= { steps: {}, updatedAt: at });
  let result = rec.result;
  if (result !== undefined && JSON.stringify(result).length > MAX_RESULT) result = undefined;
  j.steps[key] = { ...rec, at, ...(result !== undefined ? { result } : { result: undefined }), ...(rec.error ? { error: rec.error.slice(0, 300) } : {}) };
  if (j.steps[key].result === undefined) delete j.steps[key].result;
  j.updatedAt = at;
  return log;
}

/** Last finished step key in record order (for "resumed after X" lines). */
export const lastDone = (log: JobLog, job: string) => Object.entries(log[job]?.steps ?? {}).filter(([, s]) => s.status === "done").sort((a, b) => a[1].at.localeCompare(b[1].at)).at(-1)?.[0] ?? null;

// ---- Leases ------------------------------------------------------------------

export function parseLease(raw: unknown): Lease | null {
  const l = raw as Partial<Lease> | null;
  return l && typeof l.owner === "string" && Number.isFinite(l.until) ? { owner: l.owner, until: l.until as number } : null;
}
/** May `owner` take (or renew) the lease? Free when missing, expired, or already its own. */
export const leaseFree = (l: Lease | null, owner: string, now: number) => !l || l.owner === owner || l.until <= now;
