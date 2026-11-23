// "Planet Earth" view data (feat/earth-globe): today's hotspots → story rings (one per country, sized by independent outlets) and
// light arcs (a story two countries share), reusing the news-weather rules; plus the timeline strip. Pure; tests/earth.test.ts.
import { fronts, systems } from "./news-weather-pure.ts";
import type { Hotspot } from "./geo.ts";
import type { TownNews } from "./earth-pure.ts";

export type EarthRing = { key: string; label: string; title: string; lon: number; lat: number; outlets: number; color: string };
export type EarthArc = { from: { lon: number; lat: number }; to: { lon: number; lat: number }; color: string; title: string };
export type EarthData = { rings: EarthRing[]; arcs: EarthArc[]; towns: TownNews[]; timeline: { title: string; time: string; source: string }[] };

const hhmm = (iso: string | null, tz = "Europe/Tallinn") => {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
};

export function earthData(hs: Hotspot[], towns: TownNews[], now = Date.now()): EarthData {
  const sys = systems(hs), at = new Map(hs.map((h) => [h.name, h]));
  const rings = sys.map((s) => ({ key: s.key, label: s.label, title: s.title, lon: s.lon, lat: s.lat, outlets: s.outlets, color: s.color }));
  const arcs = fronts(hs, 8).flatMap((f) => {
    const a = at.get(f.from), b = at.get(f.to);
    return a && b ? [{ from: { lon: a.lon, lat: a.lat }, to: { lon: b.lon, lat: b.lat }, color: f.color, title: f.title }] : [];
  });
  const day = now - 24 * 3600_000, seen = new Set<string>();
  const timeline = hs.flatMap((h) => h.stories)
    .filter((s) => s.published_at && Date.parse(s.published_at) >= day && !seen.has(s.title) && seen.add(s.title))
    .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""))
    .slice(-7).map((s) => ({ title: s.title, time: hhmm(s.published_at), source: s.source ?? "" }));
  return { rings, arcs, towns, timeline };
}
