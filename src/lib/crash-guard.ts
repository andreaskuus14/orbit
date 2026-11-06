// Keeps one failing background job from taking the whole server down, and says which job it was when something escapes.
// Tested in tests/crash-guard.test.ts.
import { AsyncLocalStorage } from "node:async_hooks";

// The background job running in this async context (scheduler briefings, …). Errors that surface later from a stream or timer
// started inside it carry the label too, so the crash log names the job even when the error's own stack is only Node internals.
const g = globalThis as unknown as { __orbitJob?: AsyncLocalStorage<string>; __orbitCrashGuard?: boolean };
const jobs = (g.__orbitJob ??= new AsyncLocalStorage<string>());
export const asJob = <T>(name: string, fn: () => Promise<T>): Promise<T> => jobs.run(name, fn);
export const currentJob = () => jobs.getStore() ?? null;

const EXIT_EVENTS = new Set(["uncaughtException", "unhandledRejection"]);
// A process error handler whose whole body re-throws ("function(e){throw e}", "function(e){if(!(e instanceof X))throw e}", arrow
// forms) exists only to end the process. phonemizer (kokoro-js, loaded with every route by Next's entry preload) installs two:
// with them any error Next.js would log, from any job, became a server exit (2026-11-06 briefing crash).
const RETHROW = /^(?:function\s*\w*\s*\(\s*(\w+)\s*\)|\(?\s*(\w+)\s*\)?\s*=>)\s*\{\s*(?:if\s*\(\s*!\s*\(\s*(?:\1|\2)\s+instanceof\s+[\w$.]+\s*\)\s*\)\s*)?throw\s+(?:\1|\2)\s*;?\s*\}$/;
export const rethrowsOnly = (f: unknown) => typeof f === "function" && RETHROW.test(Function.prototype.toString.call(f).trim());
const dropped = (ev: string) => console.warn(`[orbit] dropped a process ${ev} handler that only re-throws (a library's; it would end the server on any error)`);

/** Once at server start (instrumentation.ts), before anything else:
 *  - logs every uncaught exception / unhandled rejection with its stack, code and background job (a monitor: it catches nothing);
 *  - removes re-throw-only process error handlers already registered and refuses new ones, whatever order Next loads modules in.
 *  Next.js's own handlers (log and keep serving) and every other handler stay as they are. */
export function installCrashGuard() {
  if (g.__orbitCrashGuard) return;
  g.__orbitCrashGuard = true;
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    const e = err as NodeJS.ErrnoException;
    console.error(`[orbit] ${origin} in ${currentJob() ?? "no background job"}${e?.code ? ` (${e.code})` : ""}:`, e?.stack ?? err);
  });
  const proc = process as unknown as import("node:events").EventEmitter;
  for (const ev of EXIT_EVENTS) for (const f of proc.listeners(ev)) if (rethrowsOnly(f)) { proc.removeListener(ev, f as () => void); dropped(ev); }
  for (const m of ["on", "addListener", "prependListener", "once", "prependOnceListener"] as const) {
    const orig = proc[m].bind(proc) as (ev: string | symbol, f: (...a: unknown[]) => void) => unknown;
    (proc as unknown as Record<string, unknown>)[m] = (ev: string | symbol, f: (...a: unknown[]) => void) => {
      if (typeof ev === "string" && EXIT_EVENTS.has(ev) && rethrowsOnly(f)) { dropped(ev); return proc; }
      return orig(ev, f);
    };
  }
}
