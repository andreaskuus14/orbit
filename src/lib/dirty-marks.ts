// In-process "something may have changed" marks for the scheduler gates (efficiency pass 2, scheduler-gate-pure.ts).
// No imports on purpose: claude.ts emit() and the missions/goals/chains writers stamp these; durable.ts and scheduler.ts read them.
const g = globalThis as unknown as { __orbitEventsDirtyAt?: number; __orbitResumeDirtyAt?: number };
/** Any event emitted (the events table grew) — also counts as "resume state may have changed". */
export const markEventsDirty = () => { g.__orbitEventsDirtyAt = g.__orbitResumeDirtyAt = Date.now(); };
/** A mission, goal or agent-team row was written. */
export const markResumeDirty = () => { g.__orbitResumeDirtyAt = Date.now(); };
export const eventsDirtyAt = () => g.__orbitEventsDirtyAt ?? 0;
export const resumeDirtyAt = () => g.__orbitResumeDirtyAt ?? 0;
