import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";

// Uncaught errors and unhandled rejections. Next's own handlers log them and keep serving, but print the raw message without a
// stack (the #407 Z_BUF_ERROR showed only its message). These replace them with the same policy: keep serving, skip React
// postpones, and write the stack, redacted, to the console and to <data dir>/crash.log (sync, so it lands even if the process dies).
const EVENTS = ["uncaughtException", "unhandledRejection"] as const;
export function logCrashes() {
  const g = globalThis as { __orbitCrashLog?: boolean };
  if (g.__orbitCrashLog) return;
  g.__orbitCrashLog = true;
  const mine = new Set<Function>();
  for (const ev of EVENTS) {
    const h = (reason: unknown) => {
      if ((reason as { $$typeof?: symbol } | null)?.$$typeof === Symbol.for("react.postpone")) return; // rendering, not an error
      const e = reason as NodeJS.ErrnoException;
      const line = redact(`${new Date().toISOString()} ${ev} ${e?.code ?? ""} ${e?.stack ?? String(reason)}\n`);
      console.error(`[orbit] ${ev} (server keeps running):\n${line}`);
      try { mkdirSync(orbitDataDir(), { recursive: true }); appendFileSync(path.join(orbitDataDir(), "crash.log"), line); } catch { /* the console line is the fallback */ }
    };
    mine.add(h);
    process.on(ev, h);
  }
  // Next adds raw-printing handlers twice: before instrumentation (next-server) and right after it (router-server).
  // shortcut: a handler added more than 5 s after boot stays; phonemizer's is kept out by importWithoutProcessHandlers.
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

/** Import a package that installs process-wide error handlers and keep them out. phonemizer (under kokoro-js) rethrows every
 *  uncaught error and unhandled rejection, which turned any stray error (the #407 Z_BUF_ERROR) into a server crash.
 *  shortcut: a listener another module adds while this import runs is dropped too; imports here are rare (first narration). */
export async function importWithoutProcessHandlers<T>(load: () => Promise<T>): Promise<T> {
  const p = process as unknown as { listeners(e: string): Function[]; off(e: string, l: Function): void };
  const before = EVENTS.map((e) => new Set(p.listeners(e)));
  try { return await load(); }
  finally { EVENTS.forEach((e, i) => { for (const l of p.listeners(e)) if (!before[i].has(l)) p.off(e, l); }); }
}
