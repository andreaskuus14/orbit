// Disk cache for the Estonia close-up labels: one Overpass answer per z13 tile, parsed to a short list, kept 30 days under
// <data dir>/cache/earth/ee-places. Requests carry only a public bounding box. Used by /api/earth/ee-places and the stills script.
import { readFile } from "node:fs/promises";
import { writeStore } from "./safe-file.ts";
import path from "node:path";
import { parsePlaces, placesQuery, ptileBox, type EePlace } from "./earth-ee-places-pure.ts";

const TTL = 30 * 864e5;
type Fetcher = (url: string) => Promise<Response>;
/** Places of one z13 tile: from the cache, else from `src` (an Overpass interpreter URL, or a function giving the raw OSM JSON). */
export async function tilePlaces(dir: string, x: number, y: number, src: string | ((b: ReturnType<typeof ptileBox>) => Promise<unknown>), get: Fetcher = fetch): Promise<EePlace[]> {
  const f = path.join(dir, `${x}_${y}.json`);
  try { const j = JSON.parse(await readFile(f, "utf8")); if (Date.now() - j.at < TTL) return j.places; } catch { /* not cached */ }
  const b = ptileBox(x, y);
  let raw: unknown;
  if (typeof src === "string") { const r = await get(`${src}?data=${encodeURIComponent(placesQuery(b))}`); if (!r.ok) throw new Error(`overpass ${r.status}`); raw = await r.json(); }
  else raw = await src(b);
  const places = parsePlaces(raw as Parameters<typeof parsePlaces>[0]);
  await writeStore(f, JSON.stringify({ at: Date.now(), places }));
  return places;
}
