import { test } from "node:test";
import assert from "node:assert/strict";
import { answerLinks, bestAttempt, BULK_BUDGET, claimPage, DEFAULT_BUDGET, enoughChars, judge, newLookup, nextRung, parseVia, rungTimeout, timeLeft, viaLine, viaSummary,
  type Attempt, type Rung } from "../src/lib/web-ladder-pure.ts";
import { bingInterval, bingNewsSearchUrl, newsFeedQuery } from "../src/lib/local-news-pure.ts";
import { buildUsed, usedLine } from "../src/lib/core-used-pure.ts";

const ALL: Record<Rung, boolean> = { fetch: true, scraper: true, browser: true };
const long = "word ".repeat(400);
const att = (rung: Rung, verdict: Attempt["verdict"], chars = 0, reason?: Attempt["reason"]): Attempt => ({ rung, ms: 1, chars, verdict, ...(reason && { reason }) });

test("judge: enough text is ok; short or JavaScript-shell pages escalate; empty pages escalate", () => {
  assert.deepEqual(judge({ text: long, status: 200, contentType: "text/html" }, 600, "fetch"), { kind: "ok" });
  assert.deepEqual(judge({ text: "Menu Home About", status: 200, contentType: "text/html" }, 600, "fetch"), { kind: "escalate", reason: "short" });
  assert.deepEqual(judge({ text: "", html: '<body><div id="root"></div><script src="/app.js"></script></body>', status: 200 }, 600, "fetch"), { kind: "escalate", reason: "js" });
  assert.deepEqual(judge({ text: "Please enable JavaScript to continue", html: "<noscript>You need to enable JavaScript to run this app.</noscript>", status: 200 }, 600, "fetch"), { kind: "escalate", reason: "js" });
  assert.deepEqual(judge({ text: "", status: 200 }, 600, "scraper"), { kind: "escalate", reason: "empty" });
});

test("judge: bot walls escalate to the next rung, but stop on the browser; CAPTCHAs and logins stop at once (never solved, never logged in)", () => {
  assert.deepEqual(judge({ text: "Just a moment...", status: 200 }, 600, "fetch"), { kind: "escalate", reason: "blocked" });
  assert.deepEqual(judge({ text: "", error: "The site answered 403" }, 600, "fetch"), { kind: "escalate", reason: "blocked" });
  assert.deepEqual(judge({ text: "Access denied", status: 403 }, 600, "browser"), { kind: "stop", reason: "blocked" });
  assert.deepEqual(judge({ text: "Verify you are human", html: '<div class="g-recaptcha"></div>', status: 200 }, 600, "fetch"), { kind: "stop", reason: "captcha" });
  assert.deepEqual(judge({ text: "", error: "The site answered 401" }, 600, "fetch"), { kind: "stop", reason: "login" });
  // a long real article that merely mentions captchas is still an article
  assert.deepEqual(judge({ text: long + " recaptcha", status: 200 }, 600, "fetch"), { kind: "ok" });
});

test("judge: dead hosts, private addresses, robots.txt refusals and non-pages stop the ladder; a missing rung is skipped", () => {
  assert.deepEqual(judge({ text: "", error: "getaddrinfo ENOTFOUND nope.example", code: "ENOTFOUND" }, 600, "fetch"), { kind: "stop", reason: "dead" });
  assert.deepEqual(judge({ text: "", error: "This address is not publicly reachable" }, 600, "fetch"), { kind: "stop", reason: "dead" }, "the SSRF guard's refusal is final");
  assert.deepEqual(judge({ text: "", error: "example.com's robots.txt asks bots not to read /x; ORBIT respects that." }, 600, "scraper"), { kind: "stop", reason: "blocked" });
  assert.deepEqual(judge({ text: "", error: "The site answered 404" }, 600, "fetch"), { kind: "stop", reason: "dead" });
  assert.deepEqual(judge({ text: "", error: "unsupported content type: application/pdf" }, 600, "fetch"), { kind: "stop", reason: "not-page" });
  assert.deepEqual(judge({ text: "", error: "Scrapling isn't installed", code: "unavailable" }, 600, "scraper"), { kind: "escalate", reason: "unavailable" });
  assert.deepEqual(judge({ text: "", error: "The operation was aborted due to timeout" }, 600, "fetch"), { kind: "escalate", reason: "error" });
});

test("nextRung: fetch → scraper → browser, only after an escalate; skips rungs not installed; respects the allowed list and the time left", () => {
  const b = DEFAULT_BUDGET;
  assert.equal(nextRung([], ALL, 60_000, b), "fetch");
  assert.equal(nextRung([att("fetch", "escalate", 0, "js")], ALL, 60_000, b), "scraper");
  assert.equal(nextRung([att("fetch", "escalate"), att("scraper", "escalate")], ALL, 60_000, b), "browser");
  assert.equal(nextRung([att("fetch", "ok", 5000)], ALL, 60_000, b), null, "a good read stops the ladder");
  assert.equal(nextRung([att("fetch", "stop", 0, "dead")], ALL, 60_000, b), null, "a dead host is not retried");
  assert.equal(nextRung([att("fetch", "escalate")], { ...ALL, scraper: false }, 60_000, b), "browser", "no Scrapling: straight to the browser");
  assert.equal(nextRung([att("fetch", "escalate")], { fetch: true, scraper: false, browser: false }, 60_000, b), null, "nothing installed: plain fetch only");
  assert.equal(nextRung([att("fetch", "escalate")], ALL, 60_000, b, ["fetch", "browser"]), "browser");
  assert.equal(nextRung([att("fetch", "escalate")], ALL, 5_000, b), null, "too little time left for a slow rung");
  assert.equal(nextRung([], ALL, 0, b), "fetch", "fetch is cheap and always gets its try");
});

test("bestAttempt: the ok read, else the longest partial page (at least 150 chars), else none", () => {
  assert.equal(bestAttempt([att("fetch", "escalate", 400, "short"), att("scraper", "ok", 3000)]), 1);
  assert.equal(bestAttempt([att("fetch", "escalate", 400, "short"), att("scraper", "escalate", 900, "short"), att("browser", "escalate", 0, "error")]), 1);
  assert.equal(bestAttempt([att("fetch", "escalate", 100, "short")]), -1);
  assert.equal(bestAttempt([att("fetch", "stop", 0, "dead")]), -1);
});

test("lookup budget: a page cap and a deadline shared by every read; per-rung timeouts never exceed what is left", () => {
  const l = newLookup({ ...DEFAULT_BUDGET, maxPages: 2, totalMs: 10_000 }, 0);
  assert.equal(claimPage(l, 0), true);
  assert.equal(claimPage(l, 1), true);
  assert.equal(claimPage(l, 2), false, "page cap");
  const l2 = newLookup(DEFAULT_BUDGET, 0);
  assert.equal(timeLeft(l2, 50_000), 10_000);
  assert.equal(rungTimeout(l2, "browser", 50_000), 10_000);
  assert.equal(rungTimeout(l2, "fetch", 0), DEFAULT_BUDGET.rungMs.fetch);
  assert.equal(rungTimeout(l2, "fetch", 70_000), 2_000, "floor so a fetch can still finish");
  assert.equal(claimPage(l2, 61_000), false, "deadline passed");
  assert.ok(BULK_BUDGET.maxPages > DEFAULT_BUDGET.maxPages);
  assert.equal(enoughChars(40_000, DEFAULT_BUDGET), 600);
  assert.equal(enoughChars(400, DEFAULT_BUDGET), 200, "short reads (briefing snippets) need proportionally less");
});

test("rung records: READ VIA lines round-trip, and the summary counts rungs", () => {
  const one = viaLine({ url: "https://a", rung: "fetch", tried: [att("fetch", "ok", 3000)] });
  assert.equal(one, "READ VIA: fetch");
  const three = viaLine({ url: "https://b", rung: "browser", tried: [att("fetch", "escalate", 0, "js"), att("scraper", "escalate", 200, "short"), att("browser", "ok", 4000)] });
  assert.equal(three, "READ VIA: browser (fetch: js → scraper: short → browser)");
  assert.equal(viaLine({ url: "https://c", rung: null, tried: [att("fetch", "stop", 0, "captcha")] }), "READ VIA: none (fetch: captcha)");
  assert.deepEqual(parseVia(`x\n${one}\ntext\n${three}\nREAD VIA: none (fetch: dead)`), ["fetch", "browser"]);
  assert.equal(viaSummary(["browser", "fetch", "fetch"]), "2 fetch · 1 browser");
  assert.equal(viaSummary([]), "");
});

test("answerLinks: markdown source links first, deduped, search-engine pages skipped", () => {
  const t = "- Fact [BBC](https://www.bbc.com/news/x). More at https://example.org/a, and [dup](https://www.bbc.com/news/x)\n- [g](https://www.google.com/search?q=x) [c](https://c.example/p#frag)";
  assert.deepEqual(answerLinks(t), ["https://www.bbc.com/news/x", "https://c.example/p", "https://example.org/a"]);
  assert.deepEqual(answerLinks(t, 1), ["https://www.bbc.com/news/x"]);
  assert.deepEqual(answerLinks("no links here"), []);
});

test("news search URLs: Bing first with its time filter and market; old Google News feeds map onto the same search", () => {
  assert.equal(bingInterval("1h"), 4);
  assert.equal(bingInterval("12h"), 7);
  assert.equal(bingInterval("2d"), 8);
  assert.equal(bingInterval("30d"), 9);
  const u = new URL(bingNewsSearchUrl("free events Tallinn", "24h", "ee", "ET"));
  assert.equal(u.hostname, "www.bing.com");
  assert.equal(u.searchParams.get("q"), "free events Tallinn");
  assert.equal(u.searchParams.get("format"), "rss");
  assert.equal(u.searchParams.get("qft"), 'interval="7"');
  assert.equal(u.searchParams.get("cc"), "EE");
  assert.equal(u.searchParams.get("setlang"), "et");
  assert.deepEqual(newsFeedQuery("https://news.google.com/rss/search?q=roblox%20when%3A7d&hl=en-US&gl=US&ceid=US:en"), { q: "roblox", window: "7d" });
  assert.deepEqual(newsFeedQuery(bingNewsSearchUrl("ai chips", "2d")), { q: "ai chips", window: "7d" });
  assert.equal(newsFeedQuery("https://feeds.bbci.co.uk/news/world/rss.xml"), null);
});

test("'what I used' shows which rung read the pages, including pages a search opened", () => {
  const u = buildUsed({ trace: [{ step: "fetch_url", ok: true, via: ["browser"] }, { step: "web_search", ok: true, via: ["fetch", "fetch"] }] });
  const web = u.items.find((i) => i.kind === "web" && i.title === "pages");
  assert.equal(web?.n, 3);
  assert.equal(web?.via, "2 fetch · 1 browser");
  const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;
  assert.match(usedLine(u, t), /used\.pages\{"n":3\} \(2 fetch · 1 browser\)/);
});
