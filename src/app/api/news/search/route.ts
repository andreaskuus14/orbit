import { requireUser } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/memory";
import { parseFeed, str, toOrQuery } from "@/lib/pure";
import { topicFeedUrl } from "@/lib/pulse";
import { geoTag, hotspots, type Story } from "@/lib/geo";

// Globe search: the user's stored articles plus live Google News results for a query or a country,
// each tagged with the countries it's about so the globe can light them up.
type Result = Story & { countries: string[]; live: boolean };
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
  const q = str(params.get("q"), 120, 2);
  const country = params.get("country") === "1"; // q is a country name: "top news about this country"
  if (!q) return Response.json({ error: "Type at least 2 characters" }, { status: 400 });

  const words = toOrQuery(q).split(" or ").filter((w) => w.length > 2).slice(0, 6);
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [stored, fresh] = await Promise.all([
    words.length && !country // a country's stored stories are already on the globe; here we add live ones
      ? sb.from("articles").select("title, url, source, summary, published_at").gte("fetched_at", since)
        .or(words.map((w) => `title.ilike.%${w.replace(/[%,()*]/g, "")}%`).join(",")).order("published_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [], error: null }),
    live(q),
  ]);
  if (stored.error) return Response.json({ error: stored.error.message }, { status: 500 });

  const seen = new Set<string>();
  const results: Result[] = [];
  for (const [list, isLive] of [[stored.data ?? [], false], [fresh, true]] as const) {
    for (const a of list as (Story & { summary?: string | null })[]) {
      const key = a.title.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 90);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ title: a.title, url: a.url, source: a.source, published_at: a.published_at, countries: geoTag(a.title, (a.summary ?? "").slice(0, 400)), live: isLive });
    }
  }
  const time = (s: Story) => (s.published_at ? Date.parse(s.published_at) || 0 : 0);
  results.sort((a, b) => time(b) - time(a));
  return Response.json({ q, country, results: results.slice(0, 40), hotspots: country ? [] : hotspots(results).hotspots });
}
