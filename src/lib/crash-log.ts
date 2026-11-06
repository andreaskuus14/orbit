import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { orbitDataDir } from "./data-dir.ts";

// Uncaught errors and unhandled rejections: logged with the stack, redacted, to the console and <data dir>/crash.log (sync, so it lands
// even if the process then stops), with the background job they came from. Then (crashVerdict):
//  - an uncaught exception is fatal by default: the process may be half-way through anything, so ORBIT stops and launch.ps1's
//    supervisor restarts it (restart recovery marks interrupted tasks; an approved action left mid-way shows "may or may not have
//    happened", never re-run on its own);
//  - except a network/stream error raised inside a briefing job (asJob "briefing:…"): the briefing's own fetch failed, nothing
//    shared is half-done, so only that job is abandoned (its run counts as failed, no automatic retry) and the server keeps serving;
//  - an unhandled rejection (a promise nobody awaited) is logged and the server keeps serving: no code was cut off mid-way, and making
//    it fatal would turn a forgotten await somewhere into a restart loop the supervisor gives up on after 5 in 10 minutes.
// Next's own handlers print the raw message (no stack, no redaction) and keep serving; they are replaced by these.
const EVENTS = ["uncaughtException", "unhandledRejection"] as const;
type G = { __orbitCrashLog?: boolean; __orbitJob?: AsyncLocalStorage<string>; __orbitStopping?: boolean };
const g = globalThis as G;
const jobs = (g.__orbitJob ??= new AsyncLocalStorage<string>());
/** Run fn as a named background job: errors that escape it later (a stream or timer it started) are attributed to it. */
export const asJob = <T>(name: string, fn: () => Promise<T>): Promise<T> => jobs.run(name, fn);
export const currentJob = () => jobs.getStore() ?? null;

// Error codes of network, TLS, stream and decompression failures: what a job's own fetch raises when a site misbehaves.
const IO_ERROR = /^(?:Z_|ECONN|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ERR_STREAM_|UND_ERR_|ABORT_ERR|ERR_SSL|ERR_TLS|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/;
const RECOVERABLE_JOB = /^briefing:/;
export type Verdict = "keep-serving" | "job-failed" | "fatal";
export function crashVerdict(ev: (typeof EVENTS)[number], err: unknown, job: string | null): Verdict {
  if (ev === "unhandledRejection") return "keep-serving";
  const code = String((err as NodeJS.ErrnoException | null)?.code ?? "");
  return job && RECOVERABLE_JOB.test(job) && IO_ERROR.test(code) ? "job-failed" : "fatal";
}
const SAYS: Record<Verdict, (job: string | null) => string> = {
  "keep-serving": () => "logged; the server keeps running",
  "job-failed": (job) => `${job} failed on a network/stream error; that job is abandoned, the server keeps running`,
  fatal: () => "fatal: ORBIT stops now and its launcher restarts it",
};

export function logCrashes(exit: (code: number) => void = (c) => process.exit(c)) {
  if (g.__orbitCrashLog) return;
  g.__orbitCrashLog = true;
  const mine = new Set<Function>();
  for (const ev of EVENTS) {
    const h = (reason: unknown) => {
      if ((reason as { $$typeof?: symbol } | null)?.$$typeof === Symbol.for("react.postpone")) return; // rendering, not an error
      const e = reason as NodeJS.ErrnoException, job = currentJob(), verdict = crashVerdict(ev, reason, job);
      const line = redact(`${new Date().toISOString()} ${ev}${job ? ` in ${job}` : ""} ${e?.code ?? ""} ${e?.stack ?? String(reason)}\n`);
      console.error(`[orbit] ${ev} (${SAYS[verdict](job)}):\n${line}`);
      try { mkdirSync(orbitDataDir(), { recursive: true }); appendFileSync(path.join(orbitDataDir(), "crash.log"), `${line}  → ${SAYS[verdict](job)}\n`); } catch { /* the console line is the fallback */ }
      if (verdict === "fatal" && !g.__orbitStopping) { // controlled: the log is on disk; a moment for in-flight writes, then stop
        g.__orbitStopping = true;
        process.exitCode = 1;
        setTimeout(() => exit(1), 1500);
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
