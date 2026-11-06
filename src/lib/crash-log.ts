import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";

// An uncaught error kills the server; Next printed no stack for one (Z_BUF_ERROR, #407). The monitor only observes: the process
// still exits as before. The stack goes to the console and to <data dir>/crash.log, written synchronously so it survives the exit.
export function logCrashes() {
  const g = globalThis as { __orbitCrashLog?: boolean };
  if (g.__orbitCrashLog) return;
  g.__orbitCrashLog = true;
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    const e = err as NodeJS.ErrnoException;
    const line = `${new Date().toISOString()} ${origin} ${e?.code ?? ""} ${e?.stack ?? String(err)}\n`;
    console.error(`[orbit] server stopping on an uncaught error (${origin}):\n${line}`);
    try { mkdirSync(orbitDataDir(), { recursive: true }); appendFileSync(path.join(orbitDataDir(), "crash.log"), line); } catch { /* the console line is the fallback */ }
  });
}
