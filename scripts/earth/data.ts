// Motion-test data from live public feeds (no ORBIT login): world RSS → hotspots (geo.ts) and Estonian local feeds → town news.
// node --experimental-strip-types scripts/earth/data.ts <out.json>
import { writeFileSync } from "node:fs";
import { parseFeed } from "../../src/lib/pure.ts";
import { hotspots } from "../../src/lib/geo.ts";
import { EE_REGIONAL_FEEDS, townNews, type LocalStory } from "../../src/lib/earth-pure.ts";
import { earthData } from "../../src/lib/earth-data-pure.ts";

const WORLD = ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://www.theguardian.com/world/rss", "https://www.aljazeera.com/xml/rss/all.xml",
  "https://rss.dw.com/rdf/rss-en-world", "https://news.err.ee/rss", "https://www.france24.com/en/rss", "https://feeds.npr.org/1004/rss.xml", "https://www.cbc.ca/webfeed/rss/rss-world"];
const get = async (u: string) => { try { const r = await fetch(u, { headers: { "User-Agent": "ORBIT/0.2" }, signal: AbortSignal.timeout(10000) }); return r.ok ? parseFeed(await r.text()) : null; } catch { return null; } };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const world = (await Promise.all(WORLD.map(get))).flatMap((f, i) => (f?.items ?? []).map((it) => ({ title: it.title, url: it.url, source: it.source ?? host(WORLD[i]), published_at: it.published, summary: it.summary })));
const { hotspots: hs } = hotspots(world, 8);
const local: LocalStory[] = (await Promise.all(EE_REGIONAL_FEEDS.map(async (f) => ((await get(f.url))?.items ?? []).map((it) => ({ title: it.title, url: it.url, source: f.title, published_at: it.published, summary: it.summary.slice(0, 400), feedHome: f.home || undefined }))))).flat();
// Tallinn has no regional paper: search Bing News (Estonia market) for the city and its districts, as the app route does
for (const q of ["Tallinn", "Lasnamäe", "Kalamaja", "Mustamäe", "Nõmme", "Kristiine", "Pirita", "Kadriorg"]) {
  const f = await get(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&cc=EE&setlang=et`);
  for (const it of f?.items ?? []) local.push({ title: it.title, url: it.url, source: it.source ?? "Bing News", published_at: it.published, summary: it.summary.slice(0, 400) });
}
const d = earthData(hs, townNews(local));
writeFileSync(process.argv[2], JSON.stringify(d));
console.log(`world ${world.length} → ${d.rings.length} rings, ${d.arcs.length} arcs; local ${local.length} → ${d.towns.length} places`);
