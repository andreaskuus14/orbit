import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { orbitDataDir } from "./data-dir.ts";

// Uncaught errors and unhandled rejections: logged with the stack, redacted, to the console and <data dir>/crash.log (sync, so it lands
// even if the process then stops), with the background job they came from (asJob). Then (crashVerdict):
//  - an uncaught exception is always fatal: it escaped every operation boundary, so the process may be half-way through anything.
//    ORBIT stops after a short grace (exit CONTROLLED_STOP_EXIT) and launch.ps1's supervisor restarts it, without a rebuild (backoff; it gives up after 5 exits in 10 minutes).
//    Restart recovery marks interrupted tasks; an approved action left mid-way shows "may or may not have happened", never re-run.
//    Recoverable failures (a feed or article fetch, a briefing) are caught where they happen: pulse.ts per feed, readArticle, and
//    pinnedGet rejects or returns the status instead of leaving a stream to fail later.
//  - an unhandled rejection (a promise nobody awaited) is logged and the server keeps serving. That is a policy choice, not a sign
//    nothing was interrupted: the async work may have partly completed before it rejected. Making it fatal would turn a forgotten
//    await somewhere into a restart loop the supervisor gives up on, so the safety comes from elsewhere: approved actions are
//    recorded "attempting" before they run and end "uncertain" when they throw after starting (agents.ts), never "failed".
// Next's own handlers print the raw message (no stack, no redaction) and keep serving; they are replaced by these.
const EVENTS = ["uncaughtException", "unhandledRejection"] as const;
type G = { __orbitCrashLog?: boolean; __orbitJob?: AsyncLocalStorage<string>; __orbitStopping?: boolean };
const g = globalThis as G;
const jobs = (g.__orbitJob ??= new AsyncLocalStorage<string>());
/** Run fn as a named background job: errors that escape it later (a stream or timer it started) are attributed to it. */
export const asJob = <T>(name: string, fn: () => Promise<T>): Promise<T> => jobs.run(name, fn);
export const currentJob = () => jobs.getStore() ?? null;

/** Exit code of a controlled stop. launch.ps1 restarts on it without the "died at boot, so rebuild" path (the build isn't the problem). */
export const CONTROLLED_STOP_EXIT = 70;
export type Verdict = "keep-serving" | "fatal";
export const crashVerdict = (ev: (typeof EVENTS)[number]): Verdict => (ev === "unhandledRejection" ? "keep-serving" : "fatal");
const SAYS: Record<Verdict, string> = {
  "keep-serving": "logged; the server keeps running",
  fatal: "fatal: ORBIT stops now and its launcher restarts it",
};

export function logCrashes(exit: (code: number) => void = (c) => process.exit(c)) {
  if (g.__orbitCrashLog) return;
  g.__orbitCrashLog = true;
  const mine = new Set<Function>();
  for (const ev of EVENTS) {
    const h = (reason: unknown) => {
      if ((reason as { $$typeof?: symbol } | null)?.$$typeof === Symbol.for("react.postpone")) return; // rendering, not an error
      const e = reason as NodeJS.ErrnoException, job = currentJob(), verdict = crashVerdict(ev);
      const line = redact(`${new Date().toISOString()} ${ev}${job ? ` in ${job}` : ""} ${e?.code ?? ""} ${e?.stack ?? String(reason)}\n`);
      console.error(`[orbit] ${ev} (${SAYS[verdict]}):\n${line}`);
      try { mkdirSync(orbitDataDir(), { recursive: true }); appendFileSync(path.join(orbitDataDir(), "crash.log"), `${line}  → ${SAYS[verdict]}\n`); } catch { /* the console line is the fallback */ }
      if (verdict === "fatal" && !g.__orbitStopping) { // controlled: the log is on disk; a moment for in-flight writes, then stop
        g.__orbitStopping = true;
        process.exitCode = CONTROLLED_STOP_EXIT;
        setTimeout(() => exit(CONTROLLED_STOP_EXIT), 1500);
      }
    };
    mine.add(h);
    process.on(ev, h);
  }
  // Next adds raw-printing handlers twice: before instrumentation (next-server) and right after it (router-server).
  // shortcut: a handler added more than 5 s after boot stays (it would then run next to these; this policy still decides the exit).
  const p = process as unknown as { listeners(e: string): Function[]; off(e: string, l: Function): void };
  const sweep = () => { for (const ev of EVENTS) for (const l of p.listeners(ev)) if (!mine.has(l)) p.off(ev, l); };
  sweep();
  setImmediate(sweep);
  setTimeout(sweep, 5_000).unref();
}

const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH|COOKIE|CREDENTIAL|PRIVATE|DSN/i;
/** An error message can carry a URL with a token, an auth header or a key: those are replaced, the stack frames are kept. */
export function redact(text: string, env: Record<string, string | undefined> = process.env): string {
  let t = text;
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 8 && SECRET_NAME.test(k)) t = t.split(v).join(`[${k}]`); // his configured secrets, by name
  return t
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[credentials]@") // user:password@host
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b([\w-]*(?:key|token|secret|sig|signature|password|passwd|code|auth|session|cookie)[\w-]*\s*[=:]\s*)(?!\[)[^\s&#"',;)]+/gi, "$1[redacted]") // in a query string or plain text
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]")
    .replace(/\b(?:sk|pk|rk|re|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{16,}/g, "[key]");
}
