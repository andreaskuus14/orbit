// INTELLIGENCE side panels: the ranked country list (flag, score, trend), the top-story card's live mini-map and the other-stories
// strip. Pure; tests/unimap.test.ts. Flags: public/flags/xx.svg (flag-icons, MIT).
import type { Hotspot } from "./geo.ts";
import { findCountry } from "./countries-pure.ts";
import { systems } from "./news-weather-pure.ts";

export type RankRow = { name: string; count: number; score: number; delta: number; lat: number; lon: number };
export type RankSnap = { at: number; counts: Record<string, number> };

/** Top `n` countries by story count. score = 1…99 against the busiest; delta = change in stories against the earlier snapshot (0 when unknown). */
export function rankRows(hs: Hotspot[], prev: Record<string, number> | null, n = 10): RankRow[] {
  const top = [...hs].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, n), max = Math.max(1, top[0]?.count ?? 1);
  return top.map((h) => ({ name: h.name, count: h.count, lat: h.lat, lon: h.lon, score: Math.max(1, Math.min(99, Math.round((h.count / max) * 99))), delta: prev && h.name in prev ? h.count - prev[h.name] : 0 }));
}

/** The snapshot to keep: the old one while it is younger than `minAgeMs`, else today's counts (so the trend compares against hours ago). */
export function nextSnap(prev: RankSnap | null, counts: Record<string, number>, now: number, minAgeMs = 6 * 3600_000): RankSnap {
  return prev && now - prev.at < minAgeMs ? prev : { at: now, counts };
}
export function parseSnap(raw: string | null): RankSnap | null {
  try { const j = raw ? JSON.parse(raw) : null; return j && typeof j.at === "number" && j.counts && typeof j.counts === "object" ? (j as RankSnap) : null; } catch { return null; }
}

/** Flag image path for a country name, or null when the name is unknown. */
export function flagPath(name: string): string | null {
  const c = findCountry(name);
  return c ? `/flags/${c.iso2.toLowerCase()}.svg` : null;
}

/** Web-Mercator tiles (z) laid out so that (lon, lat) sits in the middle of a w×h box: each tile's x/y/left/top in px. Our own tiles, no photos. */
export function miniMapTiles(lon: number, lat: number, z: number, w: number, h: number) {
  const n = 2 ** z, S = 256, la = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  const fx = ((lon + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / Math.PI) / 2) * n;
  const x0 = Math.floor(fx - w / 2 / S), x1 = Math.floor(fx + w / 2 / S), y0 = Math.max(0, Math.floor(fy - h / 2 / S)), y1 = Math.min(n - 1, Math.floor(fy + h / 2 / S));
  const out: { x: number; y: number; left: number; top: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x: ((x % n) + n) % n, y, left: Math.round(w / 2 + (x - fx) * S), top: Math.round(h / 2 + (y - fy) * S) });
  return out;
}

/** "28 min ago" style age, short. */
export function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export type TopStory = { title: string; url: string; source: string; country: string; lat: number; lon: number; outlets: number; age: string };
/** The biggest news systems as stories (most independent outlets first): the top-story card and the "other stories" strip. */
export function topStories(hs: Hotspot[], now: number, n = 4): TopStory[] {
  return systems(hs).slice(0, n).map((s) => {
    const url = s.urls[0] ?? "", st = hs.flatMap((h) => h.stories).find((x) => x.url === url);
    return { title: s.title, url, source: s.sources[0]?.source ?? "", country: s.country, lat: s.lat, lon: s.lon, outlets: s.outlets, age: ago(st?.published_at, now) };
  });
}
