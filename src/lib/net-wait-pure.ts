// Network outages (laptop just woke or rebooted, Wi-Fi not up yet): pure rules. IO: net-wait.ts.
// A failure whose cause was "no internet" is not a real problem: the job waits for the network and runs again, with backoff and a
// cap, and it never raises the red alert. Anything else (a 403, a broken tool, a bad answer) stays a real failure.

/** Error text that means the network itself was down or unreachable, not that the site/service refused. */
const NET_RE = /\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|ECONNRESET|ETIMEDOUT|ECONNABORTED|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b|fetch failed|getaddrinfo|temporary failure in name resolution|name or service not known|no address associated with hostname|network is unreachable|network is down|could not resolve host|failed to resolve|nodename nor servname|errno 11001|errno -3\b|no internet|internet connection|socket hang up/i;
export const isNetworkError = (msg: unknown): boolean => typeof msg === "string" ? NET_RE.test(msg) : msg instanceof Error ? NET_RE.test(`${msg.message} ${(msg as { cause?: { code?: string; message?: string } }).cause?.code ?? ""} ${(msg as { cause?: { message?: string } }).cause?.message ?? ""}`) : false;

/** Waits between automatic retries of one network-failed job: 30 s, 1 min, 2 min, 5 min, then 10 min. */
export const NET_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000] as const;
export const NET_MAX_TRIES = 5;
/** Only failures this recent are retried by themselves (an old one is history, not a blip). */
export const NET_RETRY_WINDOW_MS = 6 * 3_600_000;
export const netBackoff = (tries: number) => NET_BACKOFF_MS[Math.max(0, Math.min(tries, NET_BACKOFF_MS.length) - 1)] ?? NET_BACKOFF_MS[0];

/** Given when a job already failed on the network (ms timestamps), may it run again now? Up to NET_MAX_TRIES failures inside the
 *  window, each retry after the backoff for that count. */
export function netRetryDue(failedAt: number[], now: number, max = NET_MAX_TRIES): boolean {
  const recent = failedAt.filter((t) => Number.isFinite(t) && t <= now && now - t < NET_RETRY_WINDOW_MS).sort((a, b) => a - b);
  if (!recent.length) return true;
  if (recent.length >= max) return false;
  return now - recent[recent.length - 1] >= netBackoff(recent.length);
}

const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+)$/i;
/** Hosts whose DNS answer says "the internet is up": the database host when it is a remote one, else Claude's API host. */
export function probeHosts(supabaseUrl: string | undefined): string[] {
  let host = "";
  try { host = new URL(supabaseUrl ?? "").hostname; } catch { /* not set */ }
  return host && !LOCAL_HOST.test(host) ? [host] : ["api.anthropic.com"];
}

/** Scheduler: briefings' failed pulse runs (detail "<kind>: <error>") that still count as "ran" (so the slot isn't retried).
 *  Network failures of a kind don't count while that kind may still retry (netRetryDue), so the brief runs again once the
 *  network is back; after the cap they count again, as before (no retry loop). */
export function countedBriefFailures<T extends { detail: string | null; started_at: string }>(failed: T[], now: number): T[] {
  const netAt = new Map<string, number[]>();
  for (const f of failed) if (isNetworkError(f.detail ?? "")) { const k = (f.detail ?? "").split(":")[0]; netAt.set(k, [...(netAt.get(k) ?? []), Date.parse(f.started_at)]); }
  return failed.filter((f) => !isNetworkError(f.detail ?? "") || !netRetryDue(netAt.get((f.detail ?? "").split(":")[0]) ?? [], now));
}

/** Online/offline edge for one log line per change: "down" when it just went away, "up" when it came back, else null. */
export const netEdge = (prev: boolean | null, now: boolean): "down" | "up" | null => (prev === null ? (now ? null : "down") : prev === now ? null : now ? "up" : "down");

/** Boot self-test: run it again once the network is back if it ran without one (the wait timed out, or a check failed on the network). */
export function selfTestRerun(netOk: boolean, onlineAfter: boolean, checks: { status: string; detail: string }[]): boolean {
  if (!netOk || !onlineAfter) return true;
  return checks.some((c) => c.status !== "ok" && (isNetworkError(c.detail) || /check your internet|couldn't reach|could not reach/i.test(c.detail)));
}

/** Automation runs (agent tasks) that failed on the network and may go back in the queue now: top-level, not a team, no resolved
 *  action (nothing was approved or done, so a rerun repeats nothing), no sub-tasks, inside the window, and their own retry
 *  backoff passed (tries: when ORBIT already re-queued each one after a network failure). */
export function pickNetRetries(rows: { id: string; error: string | null; finished_at: string | null; title: string; pending?: { status: string }[] | null; children?: number }[],
  tries: Map<string, number[]>, now: number): string[] {
  return rows.filter((t) => {
    const at = Date.parse(t.finished_at ?? "");
    if (!isNetworkError(t.error ?? "") || !Number.isFinite(at) || now - at >= NET_RETRY_WINDOW_MS || t.title.startsWith("Team: ") || t.children) return false;
    if ((t.pending ?? []).some((p) => p.status !== "pending")) return false;
    const past = tries.get(t.id) ?? [];
    return past.length < NET_MAX_TRIES && now - at >= netBackoff(past.length + 1);
  }).map((t) => t.id);
}
