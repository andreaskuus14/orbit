// Local news per country for the INTELLIGENCE globe and CORE's read_news: Google News' country editions plus a few
// curated native feeds. Pure (no network) — tested in tests/local-news.test.ts.

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
