import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/memory";
import { polite, UA } from "@/lib/reach/net";
import { OVERPASS_URL } from "@/lib/overpass-pure";
import { BZ, capBuildings, overpassQuery, parseOverpass, tileBox, validBTile, type Building } from "@/lib/earth-buildings-pure";

// OSM buildings (© OpenStreetMap contributors, ODbL) for the Earth view's city close-ups, one z14 tile at a time from Overpass,
// cached on disk under .cache/earth/buildings for 30 days. Overpass calls go through the shared polite queue (their usage policy); when Overpass
// can't be reached the answer is an empty tile marked offline, and the view simply shows the flat imagery.
const DIR = path.join(process.cwd(), ".cache", "earth", "buildings", String(BZ));
const TTL = 30 * 24 * 3600_000;
const OVERPASS = process.env.ORBIT_OVERPASS_URL || OVERPASS_URL;

// the same polite per-host queue and User-Agent as the lead finder's Overpass calls (src/lib/overpass.ts)
async function overpass(x: number, y: number): Promise<Building[]> {
  const url = `${OVERPASS}?data=${encodeURIComponent(overpassQuery(tileBox(x, y)))}`;
  return polite(url, async () => {
    const { res } = await safeFetch(url, "application/json", `${UA} earth-buildings`, 12_000_000, 30_000);
    return capBuildings(parseOverpass(JSON.parse(await res.text())));
  });
}

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams, x = Number(q.get("x")), y = Number(q.get("y"));
  if (!validBTile(x, y)) return new Response("bad tile", { status: 400 });
  const file = path.join(DIR, `${x}_${y}.json`);
  const send = (b: unknown, cache = true) => Response.json(b, { headers: { "Cache-Control": cache ? "private, max-age=86400" : "no-store" } });
  try { const s = await stat(file); if (Date.now() - s.mtimeMs < TTL) return send(JSON.parse(await readFile(file, "utf8"))); } catch { /* not cached */ }
  try {
    const body = { x, y, buildings: await overpass(x, y) };
    await mkdir(DIR, { recursive: true }).then(() => writeFile(file, JSON.stringify(body))).catch(() => {});
    return send(body);
  } catch {
    try { return send(JSON.parse(await readFile(file, "utf8"))); } catch { return send({ x, y, buildings: [], offline: true }, false); }
  }
}
