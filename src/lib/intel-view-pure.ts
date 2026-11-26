// INTELLIGENCE: one map (the Earth). The bar's tabs fly the camera between four places; news weather is a layer you switch on at
// orbit, not another map; Esc always steps back to the whole Earth. Also the Earth's sharp-tile choice per altitude.
// Used by NewsGlobe/IntelBar/earth-scene.

export type Place = "orbit" | "country" | "region" | "town";
export type Tab = { id: Place; key: string };

/** The bar, left to right: the four places the camera flies to. */
export const TABS: readonly Tab[] = [
  { id: "orbit", key: "earth.earth" }, { id: "country", key: "earth.estonia" }, { id: "region", key: "earth.towns" }, { id: "town", key: "earth.tallinn" },
];

/** Saved on/off for the news-weather layer. */
export const WEATHER_KEY = "orbit.intel.weather";
/** Older builds saved a map choice ("weather" meant the news-weather map): that becomes the layer being on. Default: off. */
export function readWeather(get: (k: string) => string | null): boolean {
  const v = get(WEATHER_KEY);
  if (v === "on" || v === "off") return v === "on";
  return get("orbit.intel.map") === "weather" || get("orbit.earth.view") === "weather";
}

/** Esc, one step back: anywhere below the whole Earth → the whole Earth; at the whole Earth → nothing (ORBIT's own Esc takes it). */
export function escBack(place: Place): Place | null {
  return place === "orbit" ? null : "orbit";
}

/* ---------- Earth: sharp tiles for the place in view ---------- */

export type Box = { w: number; e: number; s: number; n: number };
/** Highest imagery zoom served (Sentinel-2 cloudless, ~5 m/px). */
export const DETAIL_MAX_Z = 15;
/** Most tiles one detail patch may ask for (each 256 px). */
export const DETAIL_MAX_TILES = 64;

/**
 * The sharp patch for a camera at (lon, lat, alt km) on a screen `viewPx` wide: a box about 1.6× the ground in view, and the
 * imagery zoom that gives about one tile pixel per screen pixel (capped by DETAIL_MAX_Z and the tile budget). Above 6,000 km
 * the whole-world picture is enough: null.
 */
export function detailFor(lon: number, lat: number, alt: number, viewPx: number): { box: Box; z: number; ze: number } | null {
  if (!(alt > 0) || alt > 6000 || Math.abs(lat) > 80) return null;
  const k = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const halfLat = Math.min(30, (alt * 0.5) / 111.32), halfLon = Math.min(60, (alt * 0.8) / (111.32 * k));
  const box = { w: lon - halfLon, e: lon + halfLon, s: Math.max(-84, lat - halfLat), n: Math.min(84, lat + halfLat) };
  // the ground in view is about the box's inner 60 %; that should get ~viewPx tile pixels
  let z = Math.round(Math.log2((viewPx * 360) / (256 * (box.e - box.w) * 0.6)));
  z = Math.max(3, Math.min(DETAIL_MAX_Z, z));
  while (z > 3 && tileCount(box, z) > DETAIL_MAX_TILES) z--;
  return { box, z, ze: Math.max(3, Math.min(12, z - 2)) };
}

function tileCount(b: Box, z: number): number {
  const n = 2 ** z, x = (lon: number) => ((lon + 180) / 360) * n;
  const y = (lat: number) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n;
  return (Math.floor(x(b.e)) - Math.floor(x(b.w)) + 1) * (Math.floor(y(b.s)) - Math.floor(y(b.n)) + 1);
}

/** Rebuild the detail patch? Only when the camera moved a quarter of the box or changed height by 1.8×. */
export function detailStale(have: { lon: number; lat: number; alt: number } | null, lon: number, lat: number, alt: number): boolean {
  if (!have) return true;
  const r = alt / have.alt;
  if (r > 1.8 || r < 1 / 1.8) return true;
  const span = (have.alt * 0.8) / 111.32;
  return Math.abs(lon - have.lon) * Math.cos((lat * Math.PI) / 180) > span * 0.25 || Math.abs(lat - have.lat) > span * 0.25;
}

/* ---------- layout ---------- */

export type Rect = [number, number, number, number]; // left, top, right, bottom
/** Pairs of boxes that overlap by more than `slack` px each way (the QA overlap check). */
export function overlaps(boxes: { name: string; r: Rect }[], slack = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > slack && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > slack) out.push(`${boxes[i].name} × ${boxes[j].name}`);
  }
  return out;
}
