// INTELLIGENCE → "Planet Earth" view (feat/earth-globe): the pure parts. Tile maths for the free imagery/elevation tiles, the
// documentary camera path (orbit → country → region → town), story rings and arcs, and the town geocoder that pins local news to
// Estonian towns, villages and Tallinn districts. No network, no DOM. Tests: tests/earth.test.ts. Plan: reports/earth/plan.md.

/* ---------- tile sources (free, commercial use allowed; see ATTRIBUTION) ---------- */

export type TileKind = "day" | "night" | "elev";
/** Upstream URL for one Web-Mercator tile. day = EOX Sentinel-2 cloudless 2016 (CC BY 4.0; later years are NC, so never those),
 *  night = NASA GIBS VIIRS Black Marble 2016 (max z8), elev = AWS Terrain Tiles, Terrarium encoding. */
export function upstreamTile(kind: TileKind, z: number, x: number, y: number): string {
  if (kind === "day") return `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`;
  if (kind === "night") return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}
export const MAX_Z: Record<TileKind, number> = { day: 15, night: 8, elev: 15 };
/** Is (kind, z, x, y) a real tile? Guards the tile proxy against junk paths. */
export function validTile(kind: string, z: number, x: number, y: number): kind is TileKind {
  if (kind !== "day" && kind !== "night" && kind !== "elev") return false;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > MAX_Z[kind]) return false;
  const n = 2 ** z;
  return x >= 0 && y >= 0 && x < n && y < n;
}
export const ATTRIBUTION = "Sentinel-2 cloudless 2016 by EOX (Copernicus data) · NASA Black Marble · AWS Terrain Tiles · GeoNames";

export const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export function lat2y(lat: number, z: number): number {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export type Box = { w: number; s: number; e: number; n: number };
/** Tiles at zoom z covering a lon/lat box, and the exact box they span (for draping the stitched image). */
export function tilesFor(b: Box, z: number): { x0: number; y0: number; nx: number; ny: number; box: Box } {
  const x0 = Math.floor(lon2x(b.w, z)), x1 = Math.floor(lon2x(b.e, z) - 1e-9);
  const y0 = Math.floor(lat2y(b.n, z)), y1 = Math.floor(lat2y(b.s, z) - 1e-9);
  return { x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1, box: { w: x2lon(x0, z), e: x2lon(x1 + 1, z), n: y2lat(y0, z), s: y2lat(y1 + 1, z) } };
}
/** Terrarium PNG pixel → metres. */
export const terrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/* ---------- sphere ---------- */

export const EARTH_KM = 6371;
/** lon/lat (+ height in Earth radii) → x,y,z with y up and lon 0 facing +z (three.js convention used by the scene). */
export function toXYZ(lon: number, lat: number, h = 0): [number, number, number] {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, r = 1 + h;
  return [r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo)];
}
/** Great-circle distance in km. */
export function distKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Points of a light arc between two places, lifted by up to `lift` radii in the middle (longer arcs lift more). */
export function arcPoints(a: { lon: number; lat: number }, b: { lon: number; lat: number }, n = 48, lift = 0.25): [number, number, number][] {
  const p = toXYZ(a.lon, a.lat), q = toXYZ(b.lon, b.lat);
  const dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])), om = Math.acos(dot);
  const peak = lift * (om / Math.PI) + 0.01;
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = Math.sin(om) || 1;
    const k1 = om ? Math.sin((1 - t) * om) / s : 1 - t, k2 = om ? Math.sin(t * om) / s : t;
    const v = [p[0] * k1 + q[0] * k2, p[1] * k1 + q[1] * k2, p[2] * k1 + q[2] * k2];
    const len = Math.hypot(v[0], v[1], v[2]) || 1, r = 1 + peak * Math.sin(Math.PI * t);
    out.push([(v[0] / len) * r, (v[1] / len) * r, (v[2] / len) * r]);
  }
  return out;
}
/** Story ring radius (degrees of arc) from the number of independent outlets: area grows with outlets, capped. */
export const ringDeg = (outlets: number) => 0.8 + 1.6 * Math.sqrt(Math.max(0, Math.min(outlets, 30)));

/* ---------- camera ---------- */

/** A camera pose in geo terms: what it looks at, how high (km), tilt from straight down (deg), and heading (deg, 0 = north). */
export type Pose = { lon: number; lat: number; alt: number; tilt: number; heading: number };
export type Shot = Pose & { name: string; hold: number; move: number };

export const SHOTS = {
  orbit: { name: "orbit", lon: 18, lat: 38, alt: 16000, tilt: 0, heading: 0 },
  country: { name: "country", lon: 25.0, lat: 58.4, alt: 900, tilt: 28, heading: 0 },
  region: { name: "region", lon: 25.4, lat: 58.75, alt: 210, tilt: 50, heading: -12 },
  town: { name: "town", lon: 24.745, lat: 59.437, alt: 9, tilt: 60, heading: 24 },
} as const satisfies Record<string, Pose & { name: string }>;
export type ShotName = keyof typeof SHOTS;

const smooth = (t: number) => t * t * t * (t * (6 * t - 15) + 10); // smootherstep: eases in and out, no jolt at the ends
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** Pose between a and b at t ∈ [0,1]. Altitude moves in log space (so the zoom feels even), and the ground moves fastest while
 *  the camera is high (the "fly up, travel, come down" arc of a documentary swoop). */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const e = smooth(Math.max(0, Math.min(1, t)));
  const la = Math.log(a.alt), lb = Math.log(b.alt);
  // ground position leads the altitude when descending, lags it when climbing
  const g = lb < la ? smooth(Math.min(1, e * 1.25)) : smooth(Math.max(0, e * 1.25 - 0.25));
  return {
    lon: a.lon + wrap(b.lon - a.lon) * g, lat: a.lat + (b.lat - a.lat) * g,
    alt: Math.exp(la + (lb - la) * e), tilt: a.tilt + (b.tilt - a.tilt) * e, heading: a.heading + wrap(b.heading - a.heading) * e,
  };
}
/** How long a move between two poses should take (ms): longer for bigger zoom changes, within 1.6–4.5 s. */
export function moveMs(a: Pose, b: Pose): number {
  const zoom = Math.abs(Math.log2(a.alt / b.alt)), ground = distKm(a, b) / 2000;
  return Math.round(Math.max(1600, Math.min(4500, 900 + zoom * 380 + ground * 600)));
}
/** The motion-test / intro path: hold on the planet, swoop to Estonia, glide over the region, come down into Tallinn. */
export function introPath(): Shot[] {
  const o = SHOTS.orbit, c = SHOTS.country, r = SHOTS.region, t = SHOTS.town;
  return [{ ...o, hold: 1600, move: 0 }, { ...c, hold: 1000, move: 3000 }, { ...r, hold: 900, move: 2000 }, { ...t, hold: 1800, move: 3000 }];
}
export const pathMs = (p: Shot[]) => p.reduce((s, x) => s + x.move + x.hold, 0);
/** Pose and the current/next shot at time ms along a path. Slow drift during holds so the frame never freezes. */
export function poseAt(p: Shot[], ms: number): { pose: Pose; shot: string; settled: boolean } {
  let t = Math.max(0, ms);
  for (let i = 0; i < p.length; i++) {
    const s = p[i];
    if (i > 0 && t < s.move) return { pose: lerpPose(p[i - 1], s, t / s.move), shot: s.name, settled: false };
    if (i > 0) t -= s.move;
    if (t < s.hold || i === p.length - 1) {
      const d = Math.min(t, s.hold) / 1000;
      return { pose: { ...s, heading: s.heading + d * 1.2, lon: s.lon + (s.alt > 5000 ? d * 0.8 : 0) }, shot: s.name, settled: true };
    }
    t -= s.hold;
  }
  const l = p[p.length - 1];
  return { pose: l, shot: l.name, settled: true };
}
/** Which level of detail the view should show at an altitude (km). */
export function levelAt(alt: number): "orbit" | "country" | "region" | "town" {
  return alt > 4000 ? "orbit" : alt > 400 ? "country" : alt > 40 ? "region" : "town";
}
/** 0…1 fade for a layer that lives between two altitudes (with a soft edge of `soft` in log2 units). */
export function band(alt: number, lo: number, hi: number, soft = 0.7): number {
  const l = Math.log2(alt), a = Math.log2(lo), b = Math.log2(hi);
  return Math.max(0, Math.min(1, (l - a) / soft + 0.5, (b - l) / soft + 0.5));
}

/* ---------- places (GeoNames, CC BY 4.0) and the local-news geocoder ---------- */

export type Place = { name: string; lon: number; lat: number; kind: "city" | "town" | "village" | "district"; pop: number; stem?: string; strict?: boolean };
/** Estonian places with coordinates from GeoNames. stem = the base the case endings attach to (Tallinn → Tallinna-s);
 *  strict = a name that is also a common word, matched only when capitalised mid-sentence. */
export const EE_PLACES: Place[] = [
  { name: "Tallinn", lon: 24.7536, lat: 59.437, kind: "city", pop: 438000, stem: "Tallinna" },
  { name: "Tartu", lon: 26.7290, lat: 58.3780, kind: "city", pop: 97000 },
  { name: "Narva", lon: 28.1903, lat: 59.3772, kind: "city", pop: 53000 },
  { name: "Pärnu", lon: 24.4971, lat: 58.3859, kind: "city", pop: 51000 },
  { name: "Kohtla-Järve", lon: 27.2731, lat: 59.3986, kind: "town", pop: 32000 },
  { name: "Viljandi", lon: 25.5900, lat: 58.3639, kind: "town", pop: 17000 },
  { name: "Maardu", lon: 25.0250, lat: 59.4767, kind: "town", pop: 16000 },
  { name: "Rakvere", lon: 26.3558, lat: 59.3464, kind: "town", pop: 15000 },
  { name: "Kuressaare", lon: 22.4853, lat: 58.2481, kind: "town", pop: 13000 },
  { name: "Sillamäe", lon: 27.7631, lat: 59.3997, kind: "town", pop: 12000 },
  { name: "Võru", lon: 27.0231, lat: 57.8339, kind: "town", pop: 11000 },
  { name: "Valga", lon: 26.0475, lat: 57.7778, kind: "town", pop: 12000 },
  { name: "Jõhvi", lon: 27.4211, lat: 59.3592, kind: "town", pop: 10000 },
  { name: "Haapsalu", lon: 23.5361, lat: 58.9431, kind: "town", pop: 9500 },
  { name: "Keila", lon: 24.4131, lat: 59.3036, kind: "town", pop: 10000 },
  { name: "Paide", lon: 25.5572, lat: 58.8856, kind: "town", pop: 8000 },
  { name: "Saue", lon: 24.5503, lat: 59.3231, kind: "town", pop: 6000, strict: true },
  { name: "Elva", lon: 26.4211, lat: 58.2225, kind: "town", pop: 5700 },
  { name: "Põlva", lon: 27.0731, lat: 58.0603, kind: "town", pop: 5800 },
  { name: "Rapla", lon: 24.7928, lat: 58.9944, kind: "town", pop: 5000 },
  { name: "Jõgeva", lon: 26.3936, lat: 58.7461, kind: "town", pop: 5000 },
  { name: "Kärdla", lon: 22.7500, lat: 58.9978, kind: "town", pop: 3200 },
  { name: "Türi", lon: 25.4306, lat: 58.8081, kind: "town", pop: 5000 },
  { name: "Tapa", lon: 25.9586, lat: 59.2606, kind: "town", pop: 5300, strict: true },
  { name: "Otepää", lon: 26.4983, lat: 58.0581, kind: "town", pop: 2000 },
  { name: "Kärdla", lon: 22.75, lat: 58.9978, kind: "town", pop: 3200 },
  { name: "Põltsamaa", lon: 25.9653, lat: 58.6525, kind: "town", pop: 4000 },
  { name: "Kunda", lon: 26.5286, lat: 59.4975, kind: "town", pop: 3000 },
  { name: "Tõrva", lon: 25.9344, lat: 58.0025, kind: "town", pop: 2600 },
  { name: "Kiviõli", lon: 26.9714, lat: 59.3528, kind: "town", pop: 5000 },
  { name: "Narva-Jõesuu", lon: 28.0436, lat: 59.4589, kind: "town", pop: 2700 },
  { name: "Viimsi", lon: 24.8197, lat: 59.5011, kind: "village", pop: 20000 },
  { name: "Saku", lon: 24.6644, lat: 59.3014, kind: "village", pop: 5000, strict: true },
  { name: "Kose", lon: 25.1683, lat: 59.1847, kind: "village", pop: 2000, strict: true },
  { name: "Otepää", lon: 26.4983, lat: 58.0581, kind: "town", pop: 2000 },
  { name: "Kuusalu", lon: 25.4397, lat: 59.4475, kind: "village", pop: 1200 },
  { name: "Antsla", lon: 26.5400, lat: 57.8256, kind: "town", pop: 1300 },
  { name: "Mustvee", lon: 26.9469, lat: 58.8483, kind: "town", pop: 1200 },
  { name: "Orissaare", lon: 23.0828, lat: 58.5606, kind: "village", pop: 900 },
  { name: "Vändra", lon: 25.0353, lat: 58.6483, kind: "village", pop: 2200 },
  { name: "Kilingi-Nõmme", lon: 24.9578, lat: 58.1500, kind: "town", pop: 1600 },
  { name: "Sindi", lon: 24.6672, lat: 58.4006, kind: "town", pop: 4000 },
  { name: "Räpina", lon: 27.4636, lat: 58.0981, kind: "town", pop: 2200 },
  { name: "Lihula", lon: 23.8469, lat: 58.6811, kind: "town", pop: 1200 },
  // Tallinn districts, for the city close-up
  { name: "Vanalinn", lon: 24.7453, lat: 59.4372, kind: "district", pop: 0 },
  { name: "Kalamaja", lon: 24.7350, lat: 59.4461, kind: "district", pop: 0 },
  { name: "Kadriorg", lon: 24.7900, lat: 59.4383, kind: "district", pop: 0 },
  { name: "Lasnamäe", lon: 24.8450, lat: 59.4300, kind: "district", pop: 0 },
  { name: "Mustamäe", lon: 24.6750, lat: 59.4050, kind: "district", pop: 0 },
  { name: "Kristiine", lon: 24.7150, lat: 59.4250, kind: "district", pop: 0 },
  { name: "Nõmme", lon: 24.6880, lat: 59.3800, kind: "district", pop: 0 },
  { name: "Pirita", lon: 24.8350, lat: 59.4700, kind: "district", pop: 0 },
  { name: "Haabersti", lon: 24.6400, lat: 59.4300, kind: "district", pop: 0 },
  { name: "Ülemiste", lon: 24.7980, lat: 59.4220, kind: "district", pop: 0 },
  { name: "Rotermanni", lon: 24.7590, lat: 59.4380, kind: "district", pop: 0 },
].filter((p, i, a) => a.findIndex((q) => q.name === p.name) === i);

// Estonian case endings that attach to a place name (inessive, elative, illative, adessive, ablative, allative, comitative,
// terminative, essive, abessive, translative, partitive), plus the genitive -i/-a for consonant-final stems.
const ENDINGS = "s|st|sse|l|lt|le|ga|ni|na|ta|ks|t|d|i|a";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LETTER = "\\p{L}";
const RX = new Map<string, RegExp>();
function placeRx(p: Place): RegExp {
  let rx = RX.get(p.name);
  if (!rx) {
    const stems = [p.name, ...(p.stem ? [p.stem] : [])].map(esc).join("|");
    rx = new RegExp(`(?<!${LETTER})(?:${stems})(?:${ENDINGS})?(?!${LETTER})`, p.strict ? "gu" : "giu");
    RX.set(p.name, rx);
  }
  rx.lastIndex = 0;
  return rx;
}
/** Places named in a story (most specific first: districts, villages, towns, then cities), at most `max`.
 *  A strict name (also a common word) counts only when capitalised and not the first word of the text. */
export function placesIn(text: string, places: Place[] = EE_PLACES, max = 3): Place[] {
  const rank = { district: 0, village: 1, town: 2, city: 3 } as const;
  const hits: Place[] = [];
  for (const p of places) {
    const rx = placeRx(p);
    let m: RegExpExecArray | null, ok = false;
    while ((m = rx.exec(text))) {
      if (p.strict && (m.index === 0 || /[.!?:]\s*$/.test(text.slice(0, m.index)))) continue;
      ok = true; break;
    }
    if (ok) hits.push(p);
  }
  return hits.sort((a, b) => rank[a.kind] - rank[b.kind] || b.pop - a.pop).slice(0, max);
}

/** Regional outlets and the town each one is "from" (a story that names no place is pinned there, weakly). */
export const EE_REGIONAL_FEEDS: { url: string; title: string; home: string }[] = [
  { url: "https://tartu.postimees.ee/rss", title: "Tartu Postimees", home: "Tartu" },
  { url: "https://parnu.postimees.ee/rss", title: "Pärnu Postimees", home: "Pärnu" },
  { url: "https://sakala.postimees.ee/rss", title: "Sakala", home: "Viljandi" },
  { url: "https://virumaateataja.postimees.ee/rss", title: "Virumaa Teataja", home: "Rakvere" },
  { url: "https://pohjarannik.postimees.ee/rss", title: "Põhjarannik", home: "Jõhvi" },
  { url: "https://jarvateataja.postimees.ee/rss", title: "Järva Teataja", home: "Paide" },
  { url: "https://valgamaalane.postimees.ee/rss", title: "Valgamaalane", home: "Valga" },
  { url: "https://saartehaal.postimees.ee/rss", title: "Saarte Hääl", home: "Kuressaare" },
  { url: "https://lounapostimees.postimees.ee/rss", title: "Lõuna-Eesti Postimees", home: "Võru" },
  { url: "https://www.err.ee/rss", title: "ERR", home: "" },
  { url: "https://news.err.ee/rss", title: "ERR News", home: "" },
];

export type LocalStory = { title: string; url: string; source: string | null; published_at: string | null; summary?: string; feedHome?: string };
export type TownNews = { name: string; lon: number; lat: number; kind: Place["kind"]; count: number; stories: (LocalStory & { weak: boolean })[] };

/** Pins stories to places: named places first; a regional feed's home town when the story names none. Newest first per place,
 *  places ranked by count. A story counts once per place even if two feeds carry it. */
export function townNews(items: LocalStory[], places: Place[] = EE_PLACES, perPlace = 8): TownNews[] {
  const by = new Map<string, TownNews>(), seen = new Set<string>();
  const get = (p: Place) => by.get(p.name) ?? by.set(p.name, { name: p.name, lon: p.lon, lat: p.lat, kind: p.kind, count: 0, stories: [] }).get(p.name)!;
  for (const it of items) {
    let hit = placesIn(`${it.title}. ${it.summary ?? ""}`, places);
    let weak = false;
    if (!hit.length && it.feedHome) { const h = places.find((p) => p.name === it.feedHome); if (h) { hit = [h]; weak = true; } }
    for (const p of hit) {
      const k = `${p.name}|${it.title.toLowerCase().trim()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const t = get(p);
      t.count++;
      t.stories.push({ title: it.title, url: it.url, source: it.source, published_at: it.published_at, weak });
    }
  }
  return [...by.values()].map((t) => ({ ...t, stories: t.stories.sort((a, b) => Number(a.weak) - Number(b.weak) || (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, perPlace) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
/** "Near you": places with news, nearest first, within maxKm of home. */
export function nearYou(towns: TownNews[], home: { lon: number; lat: number }, maxKm = 60, n = 6): (TownNews & { km: number })[] {
  return towns.map((t) => ({ ...t, km: Math.round(distKm(home, t) * 10) / 10 })).filter((t) => t.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, n);
}
