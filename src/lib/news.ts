import { safeFetch } from "./memory";
import { bareHeadline, bingNewsUrl, decodeGoogleNewsId, hostMatchesSource, extractArticle, extractLinks, parseFeed, sameHeadline } from "./pure";
import { renderPage } from "./browser";
import { googleNewsSearchUrl, googleNewsTopUrl, isEditionOf, LOCAL_FEEDS } from "./local-news-pure";
import { createTtlCache, envOn } from "./ttl-cache-pure";

// Turning news links into readable full articles. Google News RSS wraps every link in a news.google.com
// redirect; we unwrap it (old ids decode locally, new ids go through the same endpoint Google's own page uses).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const g = globalThis as unknown as { __orbitGnCache?: Map<string, string> };
const cache = (g.__orbitGnCache ??= new Map());

async function viaGoogleApi(id: string): Promise<string | null> {
  // shortcut: relies on Google's undocumented "garturlreq" call (as used by its own article page); if Google
  // changes it, links stay as Google redirects and briefings fall back to headlines. Revisit if that happens.
  const page = await fetch(`https://news.google.com/articles/${id}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  const html = await page.text();
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) return null;
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sig]);
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA },
    body: `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const chunk = text.split("\n\n")[1];
  if (!chunk) return null;
  const url = JSON.parse(JSON.parse(chunk)[0][2])[1];
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

/** The same story on Bing News (its links carry the publisher URL in plain sight): Google's unwrap call lands on the EU
 *  consent page from Estonia. Sends only the public headline. */
async function viaBing(title: string, source?: string | null): Promise<string | null> {
  const q = bareHeadline(title, source);
  if (q.length < 12) return null;
  // Plain headline first; then with the publisher's name, which finds stories Bing ranks low (live 18 Nov: 6/10 → 7/10).
  for (const query of source ? [q, `${q} ${source.replace(/\.(com|net|org)$/i, "")}`] : [q]) {
    const { res } = await safeFetch(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`, "application/rss+xml, application/xml, text/xml", UA);
    for (const it of parseFeed((await res.text()).slice(0, 1_000_000)).items) {
      const real = bingNewsUrl(it.url);
      // Same headline AND the named publisher's site: a look-alike headline elsewhere is a different article.
      if (real && sameHeadline(q, it.title) && (!source || hostMatchesSource(new URL(real).hostname, source))) return real;
    }
  }
  return null;
}

export type NewsHint = { title: string; source?: string | null };

/** The publisher's own URL for a Google News link (or the input unchanged for any other link). With the headline (hint),
 *  a link Google won't unwrap is found on Bing News instead. */
export async function resolveNewsUrl(url: string, hint?: NewsHint): Promise<string> {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.hostname !== "news.google.com") return url;
  const id = u.pathname.match(/\/(?:rss\/)?articles\/([^/?#]+)/)?.[1];
  if (!id) return url;
  const hit = cache.get(id);
  if (hit) return hit;
  let real: string | null = null;
  const local = decodeGoogleNewsId(id);
  if (local.url) real = local.url;
  else {
    try { real = await viaGoogleApi(id); } catch { real = null; }
  }
  if (!real && hint?.title) { try { real = await viaBing(hint.title, hint.source); } catch { real = null; } }
  if (real) { cache.set(id, real); if (cache.size > 5000) cache.clear(); }
  return real ?? url;
}

/** Full text of a web page or news article (main content only). Plain download first; if that gets
 *  nothing readable (JavaScript-built page, bot wall), the hidden browser loads it. Null if both fail. */
export type Page = { url: string; title: string; text: string; links: { text: string; url: string }[] };
// Article text cache: the morning/midday/evening briefings and the citation check re-read many of the same top stories.
// A published article doesn't change within hours; only readable results are kept (a failure is retried). ORBIT_ARTICLE_CACHE=0 = off.
const AC = globalThis as unknown as { __orbitArticles?: ReturnType<typeof createTtlCache<Page | null>> };
const articles = (AC.__orbitArticles ??= createTtlCache<Page | null>({ max: 400, ttlMs: 6 * 3_600_000 }));
export async function readArticle(url: string, maxChars = 4000, useBrowser = true, hint?: NewsHint): Promise<Page | null> {
  // Long reads (an agent's read_url, 40k) always go live: a page it opens may be a price or status that just changed.
  if (maxChars > 4000 || !envOn(process.env.ORBIT_ARTICLE_CACHE)) return readArticleNow(url, maxChars, useBrowser, hint);
  const p = await articles.memo(`${maxChars}|${useBrowser ? 1 : 0}|${url}`, () => readArticleNow(url, maxChars, useBrowser, hint));
  return p && { ...p, links: [...p.links] }; // a copy: callers may rewrite fields
}
async function readArticleNow(url: string, maxChars: number, useBrowser: boolean, hint?: NewsHint): Promise<Page | null> {
  let real = url;
  let plain: Page | null = null;
  try {
    real = await resolveNewsUrl(url, hint);
    if (new URL(real).hostname === "news.google.com") return null;
    const { res, url: finalUrl } = await safeFetch(real, "text/html", UA);
    if ((res.headers.get("content-type") ?? "").includes("html")) {
      const html = await res.text(); // capped at 3 MB while downloading (safeFetch)
      const art = extractArticle(html, maxChars);
      if (art.text.length >= 300) plain = { url: finalUrl.toString(), title: art.title, text: art.text, links: extractLinks(html, finalUrl.toString()) };
    }
  } catch {
    /* fall through to the browser */
  }
  // A short plain result is often just a nav bar or cookie notice around a JavaScript-built page: try the browser too.
  if (!useBrowser || (plain && plain.text.length >= Math.min(1500, maxChars))) return plain;
  const page = await renderPage(real, UA);
  if (!page) return plain;
  const art = extractArticle(page.html, maxChars);
  // Some apps (charts, dashboards) don't use paragraphs at all: fall back to the visible text.
  const visible = page.text.replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
  const text = art.text.length >= Math.min(1500, maxChars) || art.text.length >= visible.length ? art.text : visible;
  if (text.length < 150 || (plain && plain.text.length >= text.length)) return plain;
  return { url: page.url, title: art.title, text, links: extractLinks(page.html, page.url) };
}

/* ---------- local news per country ---------- */

export type LocalItem = { title: string; url: string; source: string | null; published_at: string | null; summary: string };
const RSS = "application/rss+xml, application/xml, text/xml";
const lg = globalThis as unknown as { __orbitLocalCache?: Map<string, { at: number; items: LocalItem[] }> };
const localCache = (lg.__orbitLocalCache ??= new Map());

async function feedItems(url: string, fallbackSource: string | null, cc?: string): Promise<LocalItem[]> {
  try {
    const { res, url: finalUrl } = await safeFetch(url, RSS);
    // shortcut: "no edition" is inferred from Google redirecting to another gl (US); if Google changes that, local
    // sections fill with foreign news — switch to a fixed edition list then. Searches (q) skip the check on purpose:
    // the query keeps them relevant even when Google answers from the US edition.
    if (cc && !isEditionOf(finalUrl.toString(), cc)) return [];
    return parseFeed((await res.text()).slice(0, 2_000_000)).items.slice(0, 30).map((it) => ({
      // Google News appends " - Source" to headlines.
      title: it.source && it.title.endsWith(` - ${it.source}`) ? it.title.slice(0, -(it.source.length + 3)) : it.title,
      url: it.url, source: it.source ?? fallbackSource, published_at: it.published, summary: it.summary,
    }));
  } catch { return []; } // one feed down must not blank the rest
}

/** Local headlines for a country (ISO2): its Google News edition (top stories, or a search when q is given) plus
 *  curated native feeds. Newest first, cached 10 min. Feed text is untrusted data: parseFeed strips HTML. */
export async function localNews(cc: string, lang: string, q = "", hours = 0): Promise<LocalItem[]> {
  const key = `${cc}|${lang}|${q}|${hours}`;
  const hit = localCache.get(key);
  // Empty results (outage, or no edition and no native feeds) are kept 1 min so we neither hammer nor pin them.
  if (hit && Date.now() - hit.at < (hit.items.length ? 10 * 60_000 : 60_000)) return hit.items;
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  const native = (LOCAL_FEEDS[cc] ?? []).map((f) => feedItems(f.url, f.title));
  const google = feedItems(q ? googleNewsSearchUrl(q, cc, lang, hours ? `${hours}h` : "7d") : googleNewsTopUrl(cc, lang), null, q ? undefined : cc);
  const lists = await Promise.all([google, ...native]);
  const since = hours ? Date.now() - hours * 3600_000 : 0;
  const seen = new Set<string>();
  const items = lists.flatMap((l, i) => (i && words.length ? l.filter((it) => words.some((w) => `${it.title} ${it.summary}`.toLowerCase().includes(w))) : l))
    .filter((it) => !since || !it.published_at || Date.parse(it.published_at) >= since)
    .filter((it) => { const k = it.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 40);
  if (localCache.size > 200) localCache.clear();
  localCache.set(key, { at: Date.now(), items });
  return items;
}
