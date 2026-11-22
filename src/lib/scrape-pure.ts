// scrape_page (Scrapling): pure rules. Three fetch modes: "fast" (plain HTTP, browser-like TLS), "browser" (real Chromium for
// JS-heavy pages) and "stealth" (Scrapling's anti-bot-detection browser). Stealth is the owner's call per site: only domains in
// ORBIT_SCRAPE_STEALTH (comma-separated, subdomains included) may use it, every stealth fetch is logged, and each domain gets a
// minimum gap between requests so ORBIT never hammers a site. robots.txt is honoured in every mode. Disk side: scrape.ts.
// Tests: tests/scrape.test.ts.

export type Mode = "fast" | "browser" | "stealth";
export const MODES: readonly Mode[] = ["fast", "browser", "stealth"];
/** Seconds between two requests to the same domain, by mode (stealth is slowest: it is the one sites notice). */
export const GAP_S: Record<Mode, number> = { fast: 3, browser: 6, stealth: 15 };

export const parseMode = (v: unknown): Mode => (MODES.includes(v as Mode) ? (v as Mode) : "fast");
/** "example.com, shop.example.org" → ["example.com", "shop.example.org"] (lowercase, no scheme/path, deduped). */
export function parseStealthDomains(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
}
export const domainMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
/** null = allowed; otherwise the owner-facing reason. */
export function stealthRefusal(url: URL, mode: Mode, allowed: string[]): string | null {
  if (mode !== "stealth") return null;
  if (allowed.some((d) => domainMatches(url.hostname.toLowerCase(), d))) return null;
  return `Stealth mode is off for ${url.hostname}. The owner turns it on per site in ORBIT_SCRAPE_STEALTH (.env.local); use mode "fast" or "browser" here.`;
}
/** Wait (ms) before this request to the domain, given when it was last hit; 0 = go now. */
export const waitMs = (lastAt: number | undefined, mode: Mode, now: number) => (lastAt === undefined ? 0 : Math.max(0, lastAt + GAP_S[mode] * 1000 - now));

/** Minimal robots.txt check for one path, user-agent "*" group (Allow/Disallow, longest match wins). */
export function robotsAllows(robots: string, path: string): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const rules: { allow: boolean; p: string }[] = [];
  let inStar = false, sawAgent = false;
  for (const l of lines) {
    const [k, ...rest] = l.split(":"), key = k.trim().toLowerCase(), val = rest.join(":").trim();
    if (key === "user-agent") { if (!sawAgent) inStar = false; sawAgent = true; if (val === "*") inStar = true; continue; }
    sawAgent = false;
    if (inStar && (key === "allow" || key === "disallow") && val) rules.push({ allow: key === "allow", p: val });
  }
  const hit = rules.filter((r) => path.startsWith(r.p.replace(/\*$/, ""))).sort((a, b) => b.p.length - a.p.length || Number(b.allow) - Number(a.allow))[0];
  return hit ? hit.allow : true;
}
/** One audit line for a stealth fetch (activity log). */
export const stealthLog = (url: URL, ok: boolean) => `scrape_page stealth ${ok ? "fetched" : "failed"}: ${url.hostname}${url.pathname.slice(0, 80)}`;

/** Time limits for one helper run. Scrapling's fast fetcher retries 3× with a 20-30 s timeout each by default (60+ s), longer than
 *  the web ladder's 15-30 s rung: the helper was killed mid-retry and its retry warning ("Proxy 'None' failed (attempt 1)": Scrapling
 *  labels any connect/timeout error a proxy error, even with no proxy) became the error, which also switched the rung off for 10 min.
 *  Now: one attempt, with a request timeout that ends ~4 s before the helper's own limit. */
export function helperLimits(mode: Mode, timeoutMs?: number): { killMs: number; requestS: number; retries: number } {
  const killMs = timeoutMs ?? (mode === "fast" ? 30_000 : 90_000);
  return { killMs, requestS: Math.max(3, Math.min(mode === "fast" ? 20 : 60, Math.floor((killMs - 4_000) / 1000))), retries: 1 };
}

/** The helper ended without a JSON answer: a plain reason, and whether Scrapling itself is unusable (rung off) or it was just this page. */
export function helperFailure(code: number | null, signal: string | null, stderr: string, killMs: number): { error: string; unavailable: boolean } {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^\[[\d\- :]+\]\s+(?:INFO|WARNING):/.test(l)); // Scrapling's own retry/info logs aren't the error
  const tail = lines.slice(-3).join(" ").slice(-300);
  if (signal || code === null) return { error: `the page took longer than ${Math.round(killMs / 1000)} s and was stopped`, unavailable: false };
  if (/No module named|ModuleNotFoundError|ImportError|is not recognized/i.test(tail)) return { error: `Scrapling isn't installed (${tail || `exit ${code}`}). Run once: powershell -File tools\\scrapling\\setup.ps1`, unavailable: true };
  return { error: `the scraper stopped (exit ${code})${tail ? `: ${tail}` : ""}`, unavailable: false };
}
