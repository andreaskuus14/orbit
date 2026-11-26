// "Planet Earth" view data (feat/earth-globe): today's hotspots → story rings (one per country, sized by independent outlets) and
// light arcs (a story two countries share), reusing the news-weather rules; plus the timeline strip. Pure; tests/earth.test.ts.
import { stormLevel } from "./earth-layers-pure.ts";
import { frontType, fronts, highs, systems, weather, type FrontType } from "./news-weather-pure.ts";
import type { Hotspot } from "./geo.ts";
import type { TownNews } from "./earth-pure.ts";

export type EarthRing = { key: string; label: string; title: string; lon: number; lat: number; outlets: number; color: string; country: string };
export type EarthArc = { from: { lon: number; lat: number }; to: { lon: number; lat: number }; color: string; title: string };
/** The news-weather layer (a toggle at orbit): isobars, H/L centres with their hPa number, and fronts typed as on a pressure chart. */
export type EarthWeather = {
  isobars: { hpa: number; lines: [number, number][][] }[];
  centres: { kind: "H" | "L"; lon: number; lat: number; hpa: number; label: string }[];
  /** a spiral per news system (storm = 5+ outlets), in its region colour */
  swirls: { lon: number; lat: number; outlets: number; color: string; storm: boolean; rel: number }[];
  fronts: { from: { lon: number; lat: number }; to: { lon: number; lat: number }; type: FrontType; title: string }[];
};
export type EarthData = { rings: EarthRing[]; arcs: EarthArc[]; towns: TownNews[]; timeline: { title: string; time: string; source: string }[];
  weather: EarthWeather; /** stories per country name, for the border glow */ hot: Record<string, number> };

export function earthWeather(hs: Hotspot[]): EarthWeather {
  const w = weather(hs, null), at = new Map(hs.map((h) => [h.name, h]));
  const lows = w.systems.filter((s) => s.kind === "storm"), low = lows.length ? lows : w.systems.slice(0, 2); // no storm today: the two busiest systems
  const calm = highs(w.systems); // a region with no news at all is a high; none is drawn when every region has news
  const centres: EarthWeather["centres"] = [
    ...low.map((s) => ({ kind: "L" as const, lon: s.lon, lat: s.lat, hpa: w.hpa[s.key], label: s.label })),
    ...calm.map((h) => ({ kind: "H" as const, lon: h.lon, lat: h.lat, hpa: w.hpa[`H:${h.region}`] ?? 1028, label: h.region })),
  ];
  const fr = w.fronts.flatMap((f) => { const a = at.get(f.from), b = at.get(f.to); return a && b ? [{ from: { lon: a.lon, lat: a.lat }, to: { lon: b.lon, lat: b.lat }, type: frontType(f, w.systems), title: f.title }] : []; });
  const top = Math.max(1, ...w.systems.map((s) => s.outlets)); // levels are relative to the busiest system, so a quiet day still reads
  const swirls = w.systems.slice(0, 10).map((s) => { const l = stormLevel(s.outlets, top); return { lon: s.lon, lat: s.lat, outlets: s.outlets, color: l.color, storm: l.key === "crisis" || l.key === "rising", rel: s.outlets / top }; });
  return { isobars: w.isobars.map((i) => ({ hpa: i.hpa, lines: i.lines })), centres, swirls, fronts: fr };
}

const hhmm = (iso: string | null, tz = "Europe/Tallinn") => {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
};

export function earthData(hs: Hotspot[], towns: TownNews[], now = Date.now()): EarthData {
  const sys = systems(hs), at = new Map(hs.map((h) => [h.name, h]));
  const rings = sys.map((s) => ({ key: s.key, label: s.label, title: s.title, lon: s.lon, lat: s.lat, outlets: s.outlets, color: s.color, country: s.country }));
  const arcs = fronts(hs, 8).flatMap((f) => {
    const a = at.get(f.from), b = at.get(f.to);
    return a && b ? [{ from: { lon: a.lon, lat: a.lat }, to: { lon: b.lon, lat: b.lat }, color: f.color, title: f.title }] : [];
  });
  const day = now - 24 * 3600_000, seen = new Set<string>();
  const timeline = hs.flatMap((h) => h.stories)
    .filter((s) => s.published_at && Date.parse(s.published_at) >= day && !seen.has(s.title) && seen.add(s.title))
    .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""))
    .slice(-7).map((s) => ({ title: s.title, time: hhmm(s.published_at), source: s.source ?? "" }));
  return { rings, arcs, towns, timeline, weather: earthWeather(hs), hot: Object.fromEntries(hs.map((h) => [h.name, h.count])) };
}
