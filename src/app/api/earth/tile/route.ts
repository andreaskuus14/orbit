import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { upstreamTile, validTile } from "@/lib/earth-pure";

// Free map tiles for the Intelligence "Planet Earth" view (day imagery, night lights, elevation), fetched once and kept on disk
// under .cache/earth so the laptop works from its own copy afterwards (30-day refresh). Only the three known public sources;
// nothing about the owner goes out (the URL is just z/x/y).
const DIR = path.join(process.cwd(), ".cache", "earth");
const TTL = 30 * 24 * 3600_000;
const TYPE = { day: "image/jpeg", night: "image/png", elev: "image/png" } as const;

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  const kind = q.get("k") ?? "", z = Number(q.get("z")), x = Number(q.get("x")), y = Number(q.get("y"));
  if (!validTile(kind, z, x, y)) return new Response("bad tile", { status: 400 });
  const file = path.join(DIR, kind, String(z), `${x}_${y}`);
  const send = (b: Uint8Array) => new Response(Buffer.from(b), { headers: { "Content-Type": TYPE[kind], "Cache-Control": "public, max-age=2592000, immutable" } });
  try { const s = await stat(file); if (Date.now() - s.mtimeMs < TTL) return send(await readFile(file)); } catch { /* not cached yet */ }
  try {
    const r = await fetch(upstreamTile(kind, z, x, y), { headers: { "User-Agent": "ORBIT/0.2" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length > 2_000_000) throw new Error("too big");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, b).catch(() => {});
    return send(b);
  } catch {
    try { return send(await readFile(file)); } catch { return new Response("tile unavailable", { status: 502 }); } // stale copy beats nothing
  }
}
