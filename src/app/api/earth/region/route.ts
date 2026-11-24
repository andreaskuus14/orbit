import { readFile, stat } from "node:fs/promises";
import { earthCacheDir } from "@/lib/data-dir";
import { writeStore } from "@/lib/safe-file";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/memory";
import { parseFeed } from "@/lib/pure";
import { newsSearch } from "@/lib/news";
import { LOCAL_FEEDS } from "@/lib/local-news-pure";
import { townNews, type LocalStory } from "@/lib/earth-pure";
import { countryAt, endingsOf, inEstonia, langOf, regionKey, toPlaces, townsInView } from "@/lib/earth-region-pure";
import { cityIndex, citiesOf } from "@/lib/earth-geonames";

// Local news for the region in view outside Estonia (Earth view, phase 2): the country under the camera (GeoNames), a news search
// by name for at most 6 of its biggest towns in view (Bing in that market, Google News fallback), plus the country's configured
// feeds; stories are pinned to towns by the same geocoder. Cached 30 min per region cell, in memory and on disk. Only place
// names go out. Feed text is untrusted; parseFeed strips HTML.
const RSS = "application/rss+xml, application/xml, text/xml";
const TTL = 30 * 60_000, DIR = earthCacheDir("region");
const g = globalThis as unknown as { __orbitEarthRegion?: Map<string, { at: number; body: unknown }> };
const mem = (g.__orbitEarthRegion ??= new Map());

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams, lon = Number(q.get("lon")), lat = Number(q.get("lat")), alt = Number(q.get("alt"));
  if (![lon, lat, alt].every(Number.isFinite) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || alt <= 0) return new Response("bad view", { status: 400 });
  if (alt > 2500 || inEstonia(lon, lat)) return Response.json({ towns: [] });
  const cc = countryAt(await cityIndex(), lon, lat);
  if (!cc) return Response.json({ towns: [] });
  const key = regionKey(cc, lon, lat, alt), file = path.join(DIR, `${key.replace(/[^A-Z0-9.-]/gi, "_")}.json`);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < TTL) return Response.json(hit.body);
  try { const s = await stat(file); if (Date.now() - s.mtimeMs < TTL) { const body = JSON.parse(await readFile(file, "utf8")); mem.set(key, { at: s.mtimeMs, body }); return Response.json(body); } } catch { /* not cached */ }

  const all = await citiesOf(cc), lang = langOf(cc), view = townsInView(all, lon, lat, alt, 6);
  const toStory = (title: string, feedHome?: string) => (it: { title: string; url: string; source?: string | null; published: string | null; summary: string }): LocalStory =>
    ({ title: it.title, url: it.url, source: it.source ?? title, published_at: it.published, summary: it.summary.slice(0, 400), feedHome });
  const lists = await Promise.all([
    ...(LOCAL_FEEDS[cc] ?? []).map(async (f) => { try { const { res } = await safeFetch(f.url, RSS); return parseFeed((await res.text()).slice(0, 2_000_000)).items.slice(0, 40).map(toStory(f.title)); } catch { return []; } }),
    ...view.map((c) => newsSearch(c.name, "2d", cc, lang).then((l) => l.slice(0, 12).map(toStory(c.name, c.name))).catch(() => [] as LocalStory[])),
  ]);
  const since = Date.now() - 72 * 3600_000;
  const items = lists.flat().filter((it) => !it.published_at || Date.parse(it.published_at) >= since);
  // geocode against every town of the country (not just the searched ones), so a story naming a smaller town lands there
  const body = { at: new Date().toISOString(), cc, towns: townNews(items, toPlaces(all.slice(0, 400), lang), 6, endingsOf(lang)).slice(0, 24) };
  mem.set(key, { at: Date.now(), body });
  if (mem.size > 60) mem.delete(mem.keys().next().value!);
  await writeStore(file, JSON.stringify(body)).catch(() => {});
  return Response.json(body);
}
