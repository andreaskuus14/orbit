import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { BZ, capBuildings, overpassQuery, parseOverpass, tileBox, validBTile, type Building } from "@/lib/earth-buildings-pure";

// OSM buildings (© OpenStreetMap contributors, ODbL) for the Earth view's city close-ups, one z14 tile at a time from Overpass,
// cached on disk under .cache/earth/buildings for 30 days. One Overpass request at a time (their usage policy); when Overpass
// can't be reached the answer is an empty tile marked offline, and the view simply shows the flat imagery.
const DIR = path.join(process.cwd(), ".cache", "earth", "buildings", String(BZ));
const TTL = 30 * 24 * 3600_000;
const OVERPASS = process.env.ORBIT_OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const g = globalThis as unknown as { __orbitOverpass?: Promise<unknown> };

async function overpass(x: number, y: number): Promise<Building[]> {
  const run = async () => {
    const r = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: overpassQuery(tileBox(x, y)) }), headers: { "User-Agent": "ORBIT/0.2 (personal map view)" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(String(r.status));
    return capBuildings(parseOverpass(await r.json()));
  };
  const p = (g.__orbitOverpass ?? Promise.resolve()).catch(() => {}).then(run);
  g.__orbitOverpass = p.catch(() => {});
  return p;
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
