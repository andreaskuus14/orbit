// News search URLs for every ORBIT news lookup (read_news, news_search, Pulse topic feeds, follows, the globe): Bing News RSS
// is the search source (its links carry the publisher URL in plain sight, so the reading ladder opens the real article);
// Google News is only the last-resort fallback when Bing returns nothing. Local news per country: native feeds + Bing in the
// country's market, Google's country edition last. Pure (no network) — tested in tests/local-news.test.ts.

const BING = "https://www.bing.com/news/search";
/** Bing's time filter (qft interval) for a window like "1h", "12h", "2d", "7d": 4 = past hour, 7 = 24 h, 8 = 7 days, 9 = 30 days. */
export function bingInterval(window: string): 4 | 7 | 8 | 9 {
  const m = /^(\d+)\s*([hd])$/i.exec(window.trim());
  const h = m ? Number(m[1]) * (m[2].toLowerCase() === "d" ? 24 : 1) : 168;
  return h <= 1 ? 4 : h <= 24 ? 7 : h <= 168 ? 8 : 9;
}
/** Bing News RSS search; cc/lang (ISO2 country, language) ask for that country's market and language. */
export function bingNewsSearchUrl(q: string, window = "7d", cc?: string, lang?: string): string {
  const p = new URLSearchParams({ q, format: "rss", qft: `interval="${bingInterval(window)}"` });
  if (cc) p.set("cc", cc.toUpperCase());
  if (lang) p.set("setlang", lang.toLowerCase());
  return `${BING}?${p}`;
}
const WINDOW_OF: Record<string, string> = { "4": "1h", "7": "24h", "8": "7d", "9": "30d" };
/** A stored news-search feed URL (old Google News "q … when:7d" ones, or Bing) → its query and window, so ingest can run it through
 *  the Bing-first search. null for ordinary RSS feeds. */
export function newsFeedQuery(url: string): { q: string; window: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const q = u.searchParams.get("q");
  if (!q) return null;
  if (u.hostname === "news.google.com" && u.pathname.startsWith("/rss/search")) {
    const w = / when:(\d+[hd])\s*$/i.exec(q);
    return { q: q.replace(/ when:\d+[hd]\s*$/i, "").trim(), window: w ? w[1] : "7d" };
  }
  if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.startsWith("/news/search")) {
    const iv = /interval="?(\d)/.exec(u.searchParams.get("qft") ?? "")?.[1];
    return { q: q.trim(), window: WINDOW_OF[iv ?? ""] ?? "7d" };
  }
  return null;
}

const GN = "https://news.google.com/rss";
const locale = (cc: string, lang: string) => `hl=${lang}-${cc}&gl=${cc}&ceid=${cc}:${lang}`;

/** Google News top headlines for a country edition (Google normalises hl, e.g. pt-BR → pt-419). */
export const googleNewsTopUrl = (cc: string, lang: string) => `${GN}?${locale(cc.toUpperCase(), lang)}`;

/** Google News search inside a country edition; window is Google's own filter ("12h", "7d"). */
export const googleNewsSearchUrl = (q: string, cc: string, lang: string, window = "7d") =>
  `${GN}/search?q=${encodeURIComponent(`${q} when:${window}`)}&${locale(cc.toUpperCase(), lang)}`;

/** Countries without a Google News edition get redirected to the US one; that isn't local news. */
export function isEditionOf(finalUrl: string, cc: string): boolean {
  try { return new URL(finalUrl).searchParams.get("gl")?.toUpperCase() === cc.toUpperCase(); } catch { return false; }
}

// Native outlets, checked by hand to serve fresh RSS (Oct 2026). Delfi has no public RSS any more (its old
// FeedBurner feed stopped in 2023), so its stories come through the Google News Estonia edition instead.
export const LOCAL_FEEDS: Record<string, { url: string; title: string }[]> = {
  EE: [
    { url: "https://news.err.ee/rss", title: "ERR News" },
    { url: "https://www.err.ee/rss", title: "ERR" },
    { url: "https://news.postimees.ee/rss", title: "Postimees News" },
    { url: "https://www.postimees.ee/rss", title: "Postimees" },
  ],
};

/** Keeps a ranked list balanced: at most `share` of the first n items from any one group (e.g. the USA).
 *  Items over the cap are only used when nothing else is left to fill the list. */
export function capShare<T>(items: T[], group: (t: T) => string | null | undefined, n: number, share = 0.3): T[] {
  const cap = Math.max(1, Math.floor(n * share));
  const counts = new Map<string, number>();
  const out: T[] = [], over: T[] = [];
  for (const it of items) {
    if (out.length >= n) break;
    const g = group(it);
    const c = g ? counts.get(g) ?? 0 : 0;
    if (g && c >= cap) { over.push(it); continue; }
    if (g) counts.set(g, c + 1);
    out.push(it);
  }
  return out.length < n ? [...out, ...over.slice(0, n - out.length)] : out;
}
