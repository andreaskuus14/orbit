// A task past its budget deadline plus a grace period is stuck: some step ignored the abort signal (seen live 17 Nov:
// Prospector and Outreach sat "running" 50+ min with no new step and held queue slots). Pure; tests in tests/stall.test.ts.
export const STALL_GRACE_MS = 5 * 60_000;
export const STALLED = "stalled" as const;
export const stalledMsg = (minutes: number) =>
  `Stalled: no result ${Math.round(minutes + STALL_GRACE_MS / 60_000)} min after start (its budget is ${minutes} min). Stopped and its slot freed. Press Retry.`;

/** Resolves with the work's result, or STALLED once `deadline + STALL_GRACE_MS` passes. The late work is left to finish or fail
 *  on its own (its rejection is swallowed here so it can't crash the process). */
export function raceStall<T>(work: Promise<T>, deadline: number, now = Date.now()): Promise<T | typeof STALLED> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<typeof STALLED>((r) => { timer = setTimeout(() => r(STALLED), Math.max(0, deadline + STALL_GRACE_MS - now)); });
  (timer as { unref?: () => void } | undefined)?.unref?.(); // the watch alone never keeps a process alive
  return Promise.race([work, stall]).finally(() => clearTimeout(timer));
}
