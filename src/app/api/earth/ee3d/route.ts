import { earthCacheDir } from "@/lib/data-dir";
import { requireUser } from "@/lib/supabase/server";
import { polite, UA } from "@/lib/reach/net";
import { validETile, encodeMesh } from "@/lib/earth-ee3d-pure";
import { emptyMesh, tileMesh } from "@/lib/earth-ee3d-store";

// Estonia close-up: the Land Board's LOD2 3D buildings (© Maa- ja Ruumiamet, open data licence, credit shown in the view) for one
// z15 tile as a small binary mesh (see earth-ee3d-pure.ts). The first visit to a municipality downloads its file once (3-35 MB)
// through the polite queue and splits it into tiles under <data dir>/cache/earth/ee3d; until then the answer is 202 and the view
// asks again. When the Land Board can't be reached the view keeps the OSM buildings.
export const maxDuration = 300;
const ROOT = earthCacheDir("ee3d");
const get = (url: string) => polite(url, () => fetch(url, { headers: { "User-Agent": `${UA} earth-ee3d` }, signal: AbortSignal.timeout(240_000) }));

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams, x = Number(q.get("x")), y = Number(q.get("y"));
  if (!validETile(x, y)) return new Response("bad tile", { status: 400 });
  try {
    const m = await tileMesh(ROOT, x, y, get);
    if (m === "pending") return Response.json({ pending: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
    return new Response(Buffer.from(m ? encodeMesh(m) : emptyMesh(x, y)), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return Response.json({ offline: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
