import { readFile, stat } from "node:fs/promises";
import { earthCacheDir } from "@/lib/data-dir";
import { writeStore } from "@/lib/safe-file";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/memory";
import { polite, UA } from "@/lib/reach/net";
import { OVERPASS_URL } from "@/lib/overpass-pure";
import { BZ, tileBox, validBTile } from "@/lib/earth-buildings-pure";
import { groundQuery, parseGround } from "@/lib/earth-ground-pure";

// OSM buildings and the vector ground under them (water, coast, parks, land use, roads, railways; © OpenStreetMap contributors,
// ODbL) for the Earth view's city close-ups, one z14 tile at a time from one Overpass call,
// cached on disk under <data dir>/cache/earth/buildings for 30 days. Overpass calls go through the shared polite queue (their usage policy); when Overpass
// can't be reached the answer is an empty tile marked offline, and the view simply shows the flat imagery.
const DIR = earthCacheDir("buildings", String(BZ));
const TTL = 30 * 24 * 3600_000;
const OVERPASS = process.env.ORBIT_OVERPASS_URL || OVERPASS_URL;

// the same polite per-host queue and User-Agent as the lead finder's Overpass calls (src/lib/overpass.ts)
async function overpass(x: number, y: number) {
  const url = `${OVERPASS}?data=${encodeURIComponent(groundQuery(tileBox(x, y)))}`;
  return polite(url, async () => {
    const { res } = await safeFetch(url, "application/json", `${UA} earth-buildings`, 30_000_000, 45_000);
    return parseGround(JSON.parse(await res.text()), x, y);
  });
}

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams, x = Number(q.get("x")), y = Number(q.get("y"));
  if (!validBTile(x, y)) return new Response("bad tile", { status: 400 });
  const file = path.join(DIR, `${x}_${y}.json`);
  const send = (b: unknown, cache = true) => Response.json(b, { headers: { "Cache-Control": cache ? "private, max-age=86400" : "no-store" } });
  // tiles cached before the ground existed (buildings only) are fetched again
  try { const s = await stat(file); const j = JSON.parse(await readFile(file, "utf8")); if (Date.now() - s.mtimeMs < TTL && j.ground) return send(j); } catch { /* not cached */ }
  try {
    const body = { x, y, ...(await overpass(x, y)) };
    await writeStore(file, JSON.stringify(body)).catch(() => {});
    return send(body);
  } catch {
    try { return send(JSON.parse(await readFile(file, "utf8"))); } catch { return send({ x, y, buildings: [], offline: true }, false); }
  }
}
