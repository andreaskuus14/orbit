// Roadmap 21: foreground (a live CORE turn) goes first. Background loops (night, rules, missions) call idle() at their safe
// checkpoints — between items, before the next Claude call — so they pause, never abort, and lose no progress.
export function createForeground(sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = Date.now) {
  let n = 0;
  return {
    /** Mark a foreground turn as running; call the returned function once it ends (idempotent). */
    enter() { n++; let done = false; return () => { if (!done) { done = true; n--; } }; },
    active: () => n > 0,
    /** Wait while a foreground turn runs, at most maxMs (a stuck turn never starves background work). true = idle now. */
    async idle(maxMs = 180_000, stepMs = 500) {
      const end = now() + maxMs;
      while (n > 0 && now() < end) await sleep(stepMs);
      return n === 0;
    },
  };
}

const g = globalThis as { __orbitForeground?: ReturnType<typeof createForeground> };
export const foreground = (g.__orbitForeground ??= createForeground());
