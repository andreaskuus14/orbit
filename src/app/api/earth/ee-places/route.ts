import { earthCacheDir } from "@/lib/data-dir";
import { requireUser } from "@/lib/supabase/server";
import { polite, UA } from "@/lib/reach/net";
import { OVERPASS_URL } from "@/lib/overpass-pure";
import { validPTile } from "@/lib/earth-ee-places-pure";
import { tilePlaces } from "@/lib/earth-ee-places-store";

// Estonia close-up labels: district names and landmarks of one z13 tile from OpenStreetMap (ODbL, credited in the view), cached
// 30 days under <data dir>/cache/earth/ee-places. Only the tile's public bounding box goes out.
const ROOT = earthCacheDir("ee-places");
const OVERPASS = process.env.ORBIT_OVERPASS_URL || OVERPASS_URL;
const get = (url: string) => polite(url, () => fetch(url, { headers: { "User-Agent": `${UA} earth-places` }, signal: AbortSignal.timeout(60_000) }));

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams, x = Number(q.get("x")), y = Number(q.get("y"));
  if (!validPTile(x, y)) return new Response("bad tile", { status: 400 });
  try {
    return Response.json({ places: await tilePlaces(ROOT, x, y, OVERPASS, get) }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    return Response.json({ places: [], offline: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
