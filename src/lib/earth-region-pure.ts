// "Planet Earth" phase 2: local news outside Estonia. GeoNames cities (CC BY 4.0, cities15000) parsed into places per country,
// the country under the camera, the towns in view, the language for its news search, and the region cache key (so a small pan
// reuses the last answer). Geocoding reuses earth-pure's placesIn/townNews with the language's case endings. Pure;
// tests/earth-region.test.ts.
import { distKm, type Place } from "./earth-pure.ts";

export type City = { name: string; ascii: string; lon: number; lat: number; cc: string; pop: number };
/** One GeoNames dump line (tab separated) → a city, or null for junk. Columns: 1 name, 2 asciiname, 4 lat, 5 lon, 6 class, 8 cc, 14 pop. */
export function parseGeoLine(line: string): City | null {
  const f = line.split("\t");
  if (f.length < 15 || f[6] !== "P") return null;
  const lat = Number(f[4]), lon = Number(f[5]), pop = Number(f[14]) || 0;
  if (!f[1] || !/^[A-Z]{2}$/.test(f[8]) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: f[1], ascii: f[2] || f[1], lon, lat, cc: f[8], pop };
}
export function parseGeoNames(text: string): City[] {
  const out: City[] = [];
  for (const l of text.split("\n")) { const c = parseGeoLine(l); if (c) out.push(c); }
  return out;
}
export function byCountry(cs: City[]): Map<string, City[]> {
  const m = new Map<string, City[]>();
  for (const c of cs) (m.get(c.cc) ?? m.set(c.cc, []).get(c.cc)!).push(c);
  for (const l of m.values()) l.sort((a, b) => b.pop - a.pop);
  return m;
}
/** The country under a point: the nearest city's (good enough at town scale; borders blur by a few km). */
export function countryAt(index: { cc: string; lon: number; lat: number }[], lon: number, lat: number): string | null {
  let best: string | null = null, bd = Infinity;
  for (const c of index) { const d = distKm(c, { lon, lat }); if (d < bd) { bd = d; best = c.cc; } }
  return bd < 400 ? best : null; // open sea
}
/** How far (km) the view reaches around its centre at an altitude. */
export const viewKm = (alt: number) => Math.max(15, Math.min(400, alt * 0.9));
/** The biggest towns within the view, at most n (these are the ones searched by name, so n keeps request volume low). */
export function townsInView(cs: City[], lon: number, lat: number, alt: number, n = 8): City[] {
  const r = viewKm(alt);
  return cs.filter((c) => distKm(c, { lon, lat }) <= r).slice(0, n);
}
/** Inflecting languages replace a name's last vowel/-s (Jūrmala → Jūrmalā, Vilnius → Vilniuje): match the bare stem too. */
const CUT = new Set(["lv", "lt"]);
/** Cities → geocoder places. Short names of smaller towns (≤ 4 letters, often common words: Ogre, Bath) only match when capitalised mid-sentence. */
export const toPlaces = (cs: City[], lang = "en"): Place[] => cs.map((c) => {
  const cut = CUT.has(lang) && c.name.length >= 5 && /[aeiouāēīūs]$/i.test(c.name) ? [c.name.replace(/(us|is|as|s|[aeiouāēīū])$/i, "")] : [];
  return { name: c.name, lon: c.lon, lat: c.lat, kind: c.pop >= 100000 ? "city" : "town", pop: c.pop,
    ...(c.ascii !== c.name ? { stem: c.ascii } : {}), ...(cut.length ? { alts: cut } : {}), ...(c.name.length <= 4 && c.pop < 100000 ? { strict: true } : {}) };
});

/** News language per country (Bing setlang / Google hl). Unknown → English. */
const LANG: Record<string, string> = { EE: "et", LV: "lv", LT: "lt", FI: "fi", SE: "sv", NO: "no", DK: "da", DE: "de", AT: "de", CH: "de", PL: "pl",
  FR: "fr", BE: "fr", ES: "es", MX: "es", AR: "es", IT: "it", PT: "pt", BR: "pt", NL: "nl", CZ: "cs", SK: "sk", HU: "hu", RO: "ro", BG: "bg",
  GR: "el", UA: "uk", RU: "ru", TR: "tr", JP: "ja", KR: "ko", CN: "zh", HR: "hr", SI: "sl", RS: "sr", IS: "is" };
export const langOf = (cc: string) => LANG[cc.toUpperCase()] ?? "en";
/** Case endings the geocoder accepts after a town name, per language (Finnish/Baltic inflect names; English has the possessive). */
const ENDINGS: Record<string, string> = {
  et: "s|st|sse|l|lt|le|ga|ni|na|ta|ks|t|d|i|a",
  fi: "ssa|ssä|sta|stä|an|än|lla|llä|lta|ltä|lle|n|a|ä|ksi|na|nä",
  lv: "s|ā|a|u|i|ai|as|ē|e",
  lt: "o|e|ą|ui|u|je|s",
  de: "s|er",
  en: "'s|’s|s",
};
export const endingsOf = (lang: string) => ENDINGS[lang] ?? ENDINGS.en;

/** Cache key for a view: the country and a ~0.5° cell, plus a coarse zoom step, so panning a little reuses the answer. */
export function regionKey(cc: string, lon: number, lat: number, alt: number): string {
  const step = alt > 150 ? 1 : 0.5;
  return `${cc}:${Math.round(lon / step) * step}:${Math.round(lat / step) * step}:${alt > 150 ? "w" : "n"}`;
}
/** Is a point inside Estonia's own (phase 1) news area? Those towns come from /api/earth/local instead. */
export const inEstonia = (lon: number, lat: number) => lon > 21.7 && lon < 28.3 && lat > 57.5 && lat < 59.8;
