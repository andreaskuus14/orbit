import { safeFetch } from "../memory";
import { stopAllOn } from "../stop-all";

// Reach's polite HTTP: an honest User-Agent, a minimum gap between requests per host and a per-day cap per host.
// No cookies, no logins, no borrowed client ids, no proxies; a 403/429 is reported as a hint, never retried around.
export const UA = "ORBIT personal assistant (+local)";
const GAP_MS: Record<string, number> = { "www.reddit.com": 6_000, "kick.com": 2_000, "api.twitch.tv": 250, "id.twitch.tv": 1_000, "api.bsky.app": 1_000, "r.jina.ai": 3_500 };
const DAY_CAP: Record<string, number> = { "www.reddit.com": 300, "kick.com": 300, "api.twitch.tv": 2_000, "id.twitch.tv": 20, "api.bsky.app": 300, "r.jina.ai": 50 };
// shortcut: counters live in memory (a restart resets the day's count); persist them if ORBIT ever restarts often.
const g = globalThis as unknown as { __orbitReachNet?: Map<string, { next: number; day: string; n: number; chain: Promise<unknown> }> };
const hosts = (g.__orbitReachNet ??= new Map());

export class Blocked extends Error { constructor(m: string, readonly status: number) { super(m); } }

/** Waits its turn for the host, then runs fn. Throws Blocked when today's cap for the host is used up. */
export function polite<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).hostname;
  const h = hosts.get(host) ?? { next: 0, day: "", n: 0, chain: Promise.resolve() };
  hosts.set(host, h);
  const run = h.chain.catch(() => {}).then(async () => {
    const day = new Date().toLocaleDateString("en-CA");
    if (h.day !== day) { h.day = day; h.n = 0; }
    if (h.n >= (DAY_CAP[host] ?? 100)) throw new Blocked(`daily request cap for ${host} reached`, 429);
    if (stopAllOn()) throw new Blocked("Stop-all is on", 0); // a scan already under way stops at its next request
    const wait = h.next - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    h.n++;
    h.next = Date.now() + (GAP_MS[host] ?? 2_000);
    return fn();
  });
  h.chain = run;
  return run;
}

/** GET JSON through safeFetch (SSRF guard, 3 MB cap), politely. "The site answered 403" etc. become Blocked with the status. */
export function getJson(url: string, accept = "application/json"): Promise<unknown> {
  return polite(url, async () => {
    try {
      const { res } = await safeFetch(url, accept, UA, 3_000_000);
      const text = await res.text();
      try { return JSON.parse(text) as unknown; } catch { throw new Blocked("answered with a web page instead of JSON (likely a bot check)", 403); }
    } catch (e) {
      const st = Number((e instanceof Error ? e.message : "").match(/answered (\d{3})/)?.[1]);
      if (st) throw new Blocked(`answered ${st}`, st);
      throw e;
    }
  });
}

/** One-line hint for a failed source. */
export function hintFor(name: string, e: unknown): string {
  if (e instanceof Blocked) {
    if (e.status === 429) return `${name}: rate-limited (${e.message}); ORBIT will try again later`;
    if (e.status === 403 || e.status === 401) return `${name} refused anonymous requests from this network (${e.message}); open it in your browser instead`;
    return `${name}: ${e.message}`;
  }
  return `${name}: ${e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message).slice(0, 160) : "request failed"}`;
}
