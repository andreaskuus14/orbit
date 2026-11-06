// Keeps one failing background job from taking the whole server down, and says which job it was when something escapes.
// Tested in tests/crash-guard.test.ts.
import { AsyncLocalStorage } from "node:async_hooks";

// The background job running in this async context (scheduler briefings, …). Errors that surface later from a stream or timer
// started inside it carry the label too, so the crash log names the job even when the error's own stack is only Node internals.
const g = globalThis as unknown as { __orbitJob?: AsyncLocalStorage<string>; __orbitCrashLog?: boolean };
const jobs = (g.__orbitJob ??= new AsyncLocalStorage<string>());
export const asJob = <T>(name: string, fn: () => Promise<T>): Promise<T> => jobs.run(name, fn);
export const currentJob = () => jobs.getStore() ?? null;

/** Logs every uncaught exception / unhandled rejection with its stack, code and the job it came from. A monitor only: it doesn't
 *  catch anything or change what happens next (Next.js logs and keeps serving). */
export function installCrashLog() {
  if (g.__orbitCrashLog) return;
  g.__orbitCrashLog = true;
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    const e = err as NodeJS.ErrnoException;
    console.error(`[orbit] ${origin} in ${currentJob() ?? "no background job"}${e?.code ? ` (${e.code})` : ""}:`, e?.stack ?? err);
  });
}

const EXIT_EVENTS = ["uncaughtException", "unhandledRejection"] as const;
const proc = process as unknown as import("node:events").EventEmitter; // the typed overloads don't accept a union of event names
/** Runs an import that registers process-wide error handlers and removes the ones it added. phonemizer (inside kokoro-js)
 *  re-throws every uncaught exception and unhandled rejection from its handler, which turns any error that Next.js would log
 *  into a server exit; the error itself still reaches Next's log and installCrashLog. */
export async function importWithoutExitHandlers<T>(load: () => Promise<T>): Promise<T> {
  const before = EXIT_EVENTS.map((ev) => new Set<unknown>(proc.listeners(ev)));
  try { return await load(); }
  finally {
    EXIT_EVENTS.forEach((ev, i) => {
      for (const f of proc.listeners(ev)) if (!before[i].has(f)) {
        proc.removeListener(ev, f as (...a: unknown[]) => void);
        console.warn(`[orbit] removed a process ${ev} handler a library added on import (it would end the server on any error)`);
      }
    });
  }
}
