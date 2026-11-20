// The web reading ladder: how ORBIT opens every page it reads (fetch_url, read_news, web_search's top links, Pulse briefings,
// lead checks, answer verification). Rung 1 "fetch": plain download + article extraction. Rung 2 "scraper": Scrapling's fast
// fetcher (browser-like TLS/headers; robots.txt + per-site gaps in scrape.ts). Rung 3 "browser": headless Chromium via
// playwright-core in a child process (render-worker.mjs). A rung only runs when the one before failed in a way the next can fix
// (JS-built page, bot wall, too little text); dead hosts, logins and CAPTCHAs stop the ladder: ORBIT never logs in or solves one.
// Every lookup has a page cap and a time budget. Pure: decisions only. Disk side: web-ladder.ts. Tests: tests/web-ladder.test.ts.

export type Rung = "fetch" | "scraper" | "browser";
export const RUNGS: readonly Rung[] = ["fetch", "scraper", "browser"];

/** What one rung got back (text = extracted main text; html only when the rung has it). */
export type RungResult = { status?: number; contentType?: string; text: string; html?: string; error?: string; code?: string };
export type Verdict = { kind: "ok" } | { kind: "escalate"; reason: Reason } | { kind: "stop"; reason: Reason };
export type Reason = "error" | "blocked" | "js" | "short" | "empty" | "dead" | "login" | "captcha" | "not-page" | "unavailable" | "budget";
export type Attempt = { rung: Rung; ms: number; chars: number; verdict: Verdict["kind"]; reason?: Reason };
/** One URL's ladder record: which rungs ran and which one gave the text (null = none). */
export type ReadRecord = { url: string; rung: Rung | null; tried: Attempt[] };

export type Budget = { maxPages: number; totalMs: number; rungMs: Record<Rung, number>; minChars: number };
/** Defaults: one lookup reads at most 6 pages in 60 s. Per-rung caps keep a slow site from eating the whole budget. */
export const DEFAULT_BUDGET: Budget = { maxPages: 6, totalMs: 60_000, rungMs: { fetch: 10_000, scraper: 30_000, browser: 30_000 }, minChars: 600 };
/** Bulk jobs (Pulse briefings): more pages, same per-page rules. */
export const BULK_BUDGET: Budget = { ...DEFAULT_BUDGET, maxPages: 45, totalMs: 150_000, rungMs: { fetch: 8_000, scraper: 15_000, browser: 25_000 } };

/** Enough readable text for this read: maxChars-limited reads (2500-char briefing snippets) need less than a full page. */
export const enoughChars = (maxChars: number, budget: Pick<Budget, "minChars">) => Math.min(budget.minChars, Math.max(150, Math.floor(maxChars / 2)));

// Network errors no other rung can fix: the host doesn't exist or refuses everyone.
const DEAD = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT"]);
// Interactive human checks: never solved, so neither the scraper nor the browser is tried for them.
const CAPTCHA = /g-recaptcha|h-captcha|hcaptcha\.com|recaptcha\/api|cf-turnstile|captcha-delivery\.com|px-captcha|verify you are (?:a )?human|are you a robot|complete the security check/i;
// Passive bot walls (a JS check a real browser passes by just loading the page) and "turn on JavaScript" shells.
const WALL = /just a moment\.\.\.|checking your browser|attention required! \| cloudflare|access denied|request blocked|enable cookies|unusual traffic/i;
const JS_SHELL = /(?:enable|turn on|requires?) javascript|javascript (?:is )?(?:disabled|required)|<div id="(?:root|app|__next|__nuxt)">\s*<\/div>|<noscript>[^<]{0,200}javascript/i;
const PRIVATE = /not publicly reachable|private (?:or local )?address|only (?:public )?http\(s\)/i;

/** Text plus markup, for the pattern checks (html is capped so a 3 MB page stays cheap to scan). */
const scan = (r: RungResult) => `${r.text.slice(0, 4000)}\n${(r.html ?? "").slice(0, 200_000)}`;

/** Judge one rung's result for a read that wants `need` characters, on rung `at`. */
export function judge(r: RungResult, need: number, at: Rung): Verdict {
  if (r.error) {
    if (r.code === "unavailable") return { kind: "escalate", reason: "unavailable" };
    if (PRIVATE.test(r.error)) return { kind: "stop", reason: "dead" }; // the SSRF guard said no: no rung may try again
    if (r.code && DEAD.has(r.code)) return { kind: "stop", reason: "dead" };
    if (/robots\.txt/i.test(r.error)) return { kind: "stop", reason: "blocked" }; // the site asked bots to stay out: respected
    const st = Number(/answered (\d{3})/.exec(r.error)?.[1] ?? r.status ?? 0);
    if (st === 401) return { kind: "stop", reason: "login" };
    if (st === 404 || st === 410) return { kind: "stop", reason: "dead" };
    if (/unsupported content type|not html/i.test(r.error)) return { kind: "stop", reason: "not-page" };
    return { kind: "escalate", reason: st === 403 || st === 429 || st === 503 ? "blocked" : "error" };
  }
  if (r.status === 401) return { kind: "stop", reason: "login" };
  const s = scan(r);
  if (CAPTCHA.test(s) && r.text.length < 3 * need) return { kind: "stop", reason: "captcha" };
  if (r.status === 403 || r.status === 429 || r.status === 503 || (WALL.test(s) && r.text.length < 3 * need)) return at === "browser" ? { kind: "stop", reason: "blocked" } : { kind: "escalate", reason: "blocked" };
  if (r.contentType && !/html|text\/plain|xml/i.test(r.contentType)) return { kind: "stop", reason: "not-page" };
  const t = r.text.trim().length;
  if (t >= need) return { kind: "ok" };
  if (!t) return { kind: "escalate", reason: JS_SHELL.test(s) ? "js" : "empty" };
  return { kind: "escalate", reason: JS_SHELL.test(s) ? "js" : "short" };
}

/** The next rung to try after `tried` (null = stop). available: rungs installed on this PC (a missing one is skipped, not fatal);
 *  left: ms left in the lookup's budget. A rung that needs more time than is left isn't started. */
export function nextRung(tried: Attempt[], available: Record<Rung, boolean>, left: number, budget: Pick<Budget, "rungMs">, allowed: readonly Rung[] = RUNGS): Rung | null {
  const last = tried[tried.length - 1];
  if (last && last.verdict !== "escalate") return null;
  const from = last ? RUNGS.indexOf(last.rung) + 1 : 0;
  for (const r of RUNGS.slice(from)) {
    if (!allowed.includes(r) || !available[r]) continue;
    // fetch always runs (it is the cheap one); the slow rungs need at least a third of their cap to be worth starting
    if (r !== "fetch" && left < budget.rungMs[r] / 3) return null;
    return r;
  }
  return null;
}

/** Which attempt's text to keep: the ok one, else the longest partial (a short real page beats nothing). -1 = none. */
export function bestAttempt(tried: Attempt[]): number {
  const ok = tried.findIndex((a) => a.verdict === "ok");
  if (ok >= 0) return ok;
  let best = -1;
  tried.forEach((a, i) => { if (a.chars >= 150 && (a.reason === "short" || a.reason === "js") && (best < 0 || a.chars > tried[best].chars)) best = i; });
  return best;
}

/** A lookup's shared state: pages started and the deadline. Pure counter; web-ladder.ts holds one per lookup. */
export type Lookup = { budget: Budget; started: number; pages: number; records: ReadRecord[] };
export const newLookup = (budget: Budget = DEFAULT_BUDGET, now = Date.now()): Lookup => ({ budget, started: now, pages: 0, records: [] });
export const timeLeft = (l: Lookup, now = Date.now()) => Math.max(0, l.started + l.budget.totalMs - now);
/** Claim one page slot; false = page cap or time budget used up (the caller stops reading more pages). */
export function claimPage(l: Lookup, now = Date.now()): boolean {
  if (l.pages >= l.budget.maxPages || timeLeft(l, now) <= 0) return false;
  l.pages++;
  return true;
}
/** Per-rung timeout: the rung cap or what is left, whichever is smaller (never under 2 s, so a fetch can still finish). */
export const rungTimeout = (l: Lookup, rung: Rung, now = Date.now()) => Math.max(2_000, Math.min(l.budget.rungMs[rung], timeLeft(l, now)));

/** "READ VIA: browser (fetch: js → scraper: short → browser)" — the line tool results carry so CORE's trace (and "what I used")
 *  can show how each page was opened. */
export function viaLine(rec: ReadRecord): string {
  const path = rec.tried.map((a) => `${a.rung}${a.verdict === "escalate" || a.verdict === "stop" ? `: ${a.reason}` : ""}`).join(" → ");
  return `READ VIA: ${rec.rung ?? "none"}${rec.tried.length > 1 || !rec.rung ? ` (${path})` : ""}`;
}
/** The rungs named by READ VIA lines in a tool result (one per page read), in order. */
export function parseVia(text: string): Rung[] {
  return [...text.matchAll(/^READ VIA: (fetch|scraper|browser)\b/gm)].map((m) => m[1] as Rung);
}
/** "2 fetch · 1 browser" for the "what I used" line; "" when nothing was recorded. */
export function viaSummary(rungs: Rung[]): string {
  const n = new Map<Rung, number>();
  for (const r of rungs) n.set(r, (n.get(r) ?? 0) + 1);
  return RUNGS.filter((r) => n.has(r)).map((r) => `${n.get(r)} ${r}`).join(" · ");
}

/** The http(s) links in a search answer's markdown ([title](url) first, bare URLs after), deduped, at most max. Search engines'
 *  own pages and redirect wrappers are skipped: they are not sources. */
export function answerLinks(text: string, max = 3): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const u = raw.replace(/[).,;:!?\]]+$/, "");
    try {
      const p = new URL(u);
      if (!/^https?:$/.test(p.protocol) || /(^|\.)(google|bing|duckduckgo)\.[a-z.]+$/.test(p.hostname)) return;
      const key = p.toString().replace(/#.*$/, "");
      if (!out.includes(key)) out.push(key);
    } catch { /* not a URL */ }
  };
  for (const m of text.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)) add(m[1]);
  for (const m of text.matchAll(/(?<!\]\()https?:\/\/[^\s<>"')\]]+/g)) add(m[0]);
  return out.slice(0, max);
}
