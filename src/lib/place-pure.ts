// Location-aware brief (pure, tested in tests/place.test.ts). Opt-in, off by default: the phone sends a coarse point only on a tap,
// the PC keeps the latest one in <data dir>/place.json (place.ts), and the brief adds at most two lines that name a saved place.
// Coordinates never leave this module's callers as text: only a saved place's name may reach the brief (and its polish model).

export type Place = { name: string; lat: number; lon: number; pc?: boolean }; // pc: the PC lives here
export type Point = { lat: number; lon: number; at: string };
export type PlaceState = { on: boolean; places: Place[]; last?: Point };

export const NEAR_KM = 2; // both points are rounded to ~1 km, so "near" needs some slack
export const STALE_MS = 12 * 3_600_000; // an older point says nothing about where he is now
export const MAX_PLACES = 12;
export const OFF: PlaceState = { on: false, places: [] };

/** ~1 km grid: 2 decimals is 1.1 km of latitude (less of longitude away from the equator). */
export const coarse = (v: number) => Math.round(v * 100) / 100;

/** A coarse point from untrusted input, or null when it isn't a real coordinate. */
export function parsePoint(raw: unknown): { lat: number; lon: number } | null {
  const o = raw as { lat?: unknown; lon?: unknown } | null;
  const lat = o?.lat, lon = o?.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: coarse(lat), lon: coarse(lon) };
}

/** A place name he typed: letters, digits and a few marks, 1–30 chars, or "". */
export const placeName = (v: unknown) => (typeof v === "string" ? v.replace(/[^\p{L}\p{N} '._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30) : "");

/** The saved-places list from untrusted input (coarse coordinates, unique names, at most one PC place), or an error. */
export function parsePlaces(raw: unknown): { ok: true; places: Place[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length > MAX_PLACES) return { ok: false, error: `places must be a list of at most ${MAX_PLACES}` };
  const out: Place[] = [];
  for (const r of raw) {
    const name = placeName((r as { name?: unknown })?.name), p = parsePoint(r);
    if (!name || !p) return { ok: false, error: "each place needs a name and a real lat/lon" };
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `"${name}" is saved twice` };
    out.push({ name, ...p, ...((r as { pc?: unknown }).pc === true && !out.some((x) => x.pc) && { pc: true }) });
  }
  return { ok: true, places: out };
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The closest saved place within NEAR_KM, or null. */
export function nearestPlace(p: { lat: number; lon: number }, places: Place[]): Place | null {
  let best: Place | null = null, bestKm = NEAR_KM;
  for (const x of places) { const d = haversineKm(p, x); if (d <= bestKm) { best = x; bestKm = d; } }
  return best;
}

/** The latest point when the feature is on and the point is fresh; else null (off, never sent, or stale). */
export const currentPoint = (s: PlaceState, now: number) => {
  const t = s.last ? Date.parse(s.last.at) : NaN;
  return s.on && s.last && Number.isFinite(t) && now - t <= STALE_MS && t <= now + 60_000 ? s.last : null;
};

export type PlaceLine = { id: string; title: string; say: string };
const clean = (t: string) => t.replace(/[^\p{L}\p{N}\s.,:;'’!?%&()/-]/gu, "").replace(/\s+/g, " ").trim();

/** The brief's place lines (0–2). waiting: titles of things waiting on him; pcOnly: how many of them can only be done on the PC.
 *  1) near a saved place and something waiting names it → "You're near School, and “buy glue at school” is waiting."
 *  2) the point is away from the PC place and something needs the PC → "You're away from your PC: 3 things need it." */
export function placeLines(s: PlaceState, now: number, waiting: string[], pcOnly: number): PlaceLine[] {
  const p = currentPoint(s, now);
  if (!p) return [];
  const out: PlaceLine[] = [];
  const near = nearestPlace(p, s.places);
  if (near) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${near.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
    const hit = waiting.find((w) => re.test(w));
    if (hit) out.push({ id: `place:${near.name}`, title: `Near ${near.name}`, say: `You're near ${near.name}, and “${clean(hit).slice(0, 70)}” is waiting.` });
  }
  const pc = s.places.find((x) => x.pc);
  if (pc && pcOnly > 0 && haversineKm(p, pc) > NEAR_KM) {
    const where = near && near !== pc ? ` at ${near.name}` : "";
    out.push({ id: "place:away", title: `Away from the PC: ${pcOnly} need it`,
      say: `You're away from your PC${where}. ${pcOnly === 1 ? "One thing needs" : `${pcOnly} things need`} the PC, so leave ${pcOnly === 1 ? "it" : "them"} for later.` });
  }
  return out;
}
