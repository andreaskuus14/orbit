import { requireUser } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/memory";
import { parseFeed } from "@/lib/pure";
import { newsSearch } from "@/lib/news";
import { EE_PLACES, EE_REGIONAL_FEEDS, townNews, type LocalStory } from "@/lib/earth-pure";

// Local news per Estonian town for the "Planet Earth" view: ERR + Postimees regional RSS, plus a Bing News search (cc=EE) for the
// bigger towns. Stories are pinned to towns by earth-pure's geocoder. Cached 15 min. Feed text is untrusted; parseFeed strips HTML.
const RSS = "application/rss+xml, application/xml, text/xml";
const g = globalThis as unknown as { __orbitEarthLocal?: { at: number; body: unknown } };

async function feed(url: string, title: string, home: string): Promise<LocalStory[]> {
  try {
    const { res } = await safeFetch(url, RSS);
    return parseFeed((await res.text()).slice(0, 2_000_000)).items.slice(0, 40)
      .map((it) => ({ title: it.title, url: it.url, source: it.source ?? title, published_at: it.published, summary: it.summary.slice(0, 400), feedHome: home || undefined }));
  } catch { return []; }
}

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  if (g.__orbitEarthLocal && Date.now() - g.__orbitEarthLocal.at < 15 * 60_000) return Response.json(g.__orbitEarthLocal.body);
  const searched = [...EE_PLACES.filter((p) => p.kind !== "district").slice(0, 6), ...EE_PLACES.filter((p) => p.kind === "district").slice(0, 8)];
  const lists = await Promise.all([
    ...EE_REGIONAL_FEEDS.map((f) => feed(f.url, f.title, f.home)),
    ...searched.map((p) => newsSearch(p.name, "2d", "EE", "et").then((l) => l.slice(0, 15).map((it) => ({ title: it.title, url: it.url, source: it.source, published_at: it.published, summary: it.summary.slice(0, 400) }))).catch(() => [] as LocalStory[])),
  ]);
  const since = Date.now() - 72 * 3600_000;
  const items = lists.flat().filter((it) => !it.published_at || Date.parse(it.published_at) >= since);
  const body = { at: new Date().toISOString(), towns: townNews(items) };
  g.__orbitEarthLocal = { at: Date.now(), body };
  return Response.json(body);
}
