import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { earthCacheDir } from "@/lib/data-dir";
import { writeStore } from "@/lib/safe-file";
import { requireUser } from "@/lib/supabase/server";
import { UA } from "@/lib/reach/net";
import { ORTHO_URL, validOrtho } from "@/lib/earth-ee3d-pure";

// Estonia close-up ground: the Land Board orthophoto (© Maa- ja Ruumiamet, open data) as Web Mercator tiles, z15-z18, kept on
// disk for 90 days under <data dir>/cache/earth/ee-ortho. At most 4 requests at a time to their tile server.
const DIR = earthCacheDir("ee-ortho");
const TTL = 90 * 24 * 3600_000;
const g = globalThis as unknown as { __eeOrtho?: { n: number; q: (() => void)[] } };
const lim = (g.__eeOrtho ??= { n: 0, q: [] });
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (lim.n >= 4) await new Promise<void>((ok) => lim.q.push(ok));
  lim.n++;
  try { return await fn(); } finally { lim.n--; lim.q.shift()?.(); }
}

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams, z = Number(q.get("z")), x = Number(q.get("x")), y = Number(q.get("y"));
  if (!validOrtho(z, x, y)) return new Response("bad tile", { status: 400 });
  const file = path.join(DIR, String(z), `${x}_${y}.jpg`);
  const send = (b: Uint8Array) => new Response(Buffer.from(b), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=2592000, immutable" } });
  try { const s = await stat(file); if (Date.now() - s.mtimeMs < TTL) return send(await readFile(file)); } catch { /* not cached */ }
  try {
    const b = await slot(async () => {
      const r = await fetch(ORTHO_URL(z, x, y), { headers: { "User-Agent": `${UA} earth-ee3d` }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      return new Uint8Array(await r.arrayBuffer());
    });
    if (b.length > 1_000_000) throw new Error("too big");
    await writeStore(file, b).catch(() => {});
    return send(b);
  } catch {
    try { return send(await readFile(file)); } catch { return new Response("tile unavailable", { status: 502 }); }
  }
}
