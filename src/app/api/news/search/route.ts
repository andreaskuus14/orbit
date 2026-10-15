import { requireUser } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/memory";
import { parseFeed, str, toOrQuery } from "@/lib/pure";
import { topicFeedUrl } from "@/lib/pulse";
import { geoTag, hotspots, importance, displayName, COUNTRIES, type Story } from "@/lib/geo";

// Globe search: the user's stored articles plus live Google News results for a query or a country,
// each tagged with the countries it's about so the globe can light them up.
type Result = Story & { countries: string[]; live: boolean; score: number };
const g = globalThis as unknown as { __orbitNewsCache?: Map<string, { at: number; items: Story[] }> };
const cache = (g.__orbitNewsCache ??= new Map());

async function live(q: string): Promise<Story[]> {
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.items;
  try {
    const { res } = await safeFetch(topicFeedUrl(q), "application/rss+xml, application/xml, text/xml");
    const items = parseFeed((await res.text()).slice(0, 2_000_000)).items.slice(0, 15)
      .map((it) => ({ title: it.title, url: it.url, source: it.source, published_at: it.published, summary: it.summary }));
    if (cache.size > 200) cache.clear();
    cache.set(q, { at: Date.now(), items });
    return items;
  } catch { return []; } // offline or blocked: stored results still work
}

export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const params = new URL(req.url).searchParams;
  // country=<world-atlas name>: "top news about this country". The headline must really be about it
  // (searching "United States" otherwise returns the SS United States and United Airlines).
  const raw = params.get("country");
  const countryName = raw && /^[\p{L} .'’-]{2,60}$/u.test(raw) ? raw : null; // country names only
  const country = !!countryName;
  // Countries whose own name isn't a reliable tag (Turkey, Georgia, Jordan) or that aren't in the gazetteer
  // fall back to the plain name appearing in the headline.
  const entry = COUNTRIES.find((c) => c.name === countryName);
  const tagged = !!entry && entry.terms.includes(displayName(entry.name));
  const q = countryName ? displayName(countryName) : str(params.get("q"), 120, 2);
  const plainName = new RegExp(`(?<![\\p{L}])${(q ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
  if (!q) return Response.json({ error: "Type at least 2 characters" }, { status: 400 });

  const words = toOrQuery(q).split(" or ").filter((w) => w.length > 2).slice(0, 6);
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [stored, fresh] = await Promise.all([
    words.length && !country // a country's stored stories are already on the globe; here we add live ones
      ? sb.from("articles").select("title, url, source, summary, published_at").gte("fetched_at", since)
        .or(words.map((w) => `title.ilike.%${w.replace(/[%,()*]/g, "")}%`).join(",")).order("published_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [], error: null }),
    live(country ? `"${q}"` : q),
  ]);
  if (stored.error) return Response.json({ error: stored.error.message }, { status: 500 });

  const seen = new Set<string>();
  const results: Result[] = [];
  for (const [list, isLive] of [[stored.data ?? [], false], [fresh, true]] as const) {
    for (const a of list as (Story & { summary?: string | null })[]) {
      const key = a.title.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 90);
      if (seen.has(key)) continue;
      seen.add(key);
      const countries = geoTag(a.title, (a.summary ?? "").slice(0, 400));
      // All tags (not just the top 3) for the filter, so headlines naming many countries still count.
      if (country && !(tagged ? geoTag(a.title, (a.summary ?? "").slice(0, 400), 99).includes(countryName!) : plainName.test(a.title))) continue;
      results.push({ title: a.title, url: a.url, source: a.source, published_at: a.published_at, countries, live: isLive, score: importance(a.title) });
    }
  }
  const time = (s: Story) => (s.published_at ? Date.parse(s.published_at) || 0 : 0);
  // Country view: biggest stories first (within ~a day, newer wins ties); search: newest first.
  results.sort((a, b) => (country ? b.score - a.score || time(b) - time(a) : time(b) - time(a)));
  return Response.json({ q, country, results: results.slice(0, 40), hotspots: country ? [] : hotspots(results).hotspots });
}
