// Disk store for the Estonia 3D close-up: downloads a municipality's LOD2 CityGML zip once (Maa- ja Ruumiamet open data), streams
// it (no unzip tool, no whole file in memory) and writes one small mesh file per z15 tile, so a tile request afterwards is one
// file read. Used by /api/earth/ee3d and the stills script. The downloads carry nothing about the owner (fixed public URLs).
import { createReadStream } from "node:fs";
import { appendFile, open, readFile, readdir, rm, stat, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { createInflateRaw } from "node:zlib";
import { writeStore } from "./safe-file.ts";
import { LOD2_URL, buildMesh, decodeMesh, encodeMesh, mergeMeshes, munisFor, parseBuildings, splitBuildings, tileOf, type Bld, type EMesh } from "./earth-ee3d-pure.ts";

export const STORE_V = 1;
const TTL = 180 * 24 * 3600_000; // the Land Board refreshes LOD2 about yearly
const MAX_ZIP = 400_000_000;
type Fetcher = (url: string) => Promise<Response>;
const busy = ((globalThis as unknown as { __ee3d?: Map<string, Promise<void>> }).__ee3d ??= new Map());

const doneFile = (dir: string) => path.join(dir, "done.json");
async function fresh(dir: string) { try { const j = JSON.parse(await readFile(doneFile(dir), "utf8")); return j.v === STORE_V && Date.now() - j.at < TTL; } catch { return false; } }

/** Downloads (once) and splits one municipality into tile files under root/<muni>/. */
async function bucket(root: string, muni: string, get: Fetcher) {
  const dir = path.join(root, muni), zip = path.join(dir, "src.zip");
  await mkdir(dir, { recursive: true });
  let have = false; try { have = (await stat(zip)).size > 100; } catch { /* not yet */ }
  if (!have) {
    const r = await get(LOD2_URL(muni));
    if (!r.ok || !r.body) throw new Error(`LOD2 ${muni}: ${r.status}`);
    const fh = await open(`${zip}.part`, "w"); let n = 0;
    try { for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) { n += c.length; if (n > MAX_ZIP) throw new Error("too big"); await fh.write(c); } } finally { await fh.close(); }
    const { rename } = await import("node:fs/promises"); await rename(`${zip}.part`, zip);
  }
  // one-entry zip: local header (30 bytes + name + extra), then the deflated GML
  const fh = await open(zip, "r"); const h = Buffer.alloc(30); await fh.read(h, 0, 30, 0); await fh.close();
  if (h.readUInt32LE(0) !== 0x04034b50 || h.readUInt16LE(8) !== 8) throw new Error("not a deflated zip");
  const start = 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  // buildings come in file order, not by place: spill each one to its tile's temp file (flat Float64), then mesh tile by tile,
  // so even Tallinn (600 MB of GML) needs little memory
  const tmp = path.join(dir, "tmp"); await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
  const pend = new Map<string, number[]>(); let held = 0;
  const flush = async (all: boolean) => { for (const [k, a] of pend) if (all || a.length > 20000) { await appendFile(path.join(tmp, k), new Uint8Array(Float64Array.from(a).buffer)); held -= a.length; pend.delete(k); } };
  const take = async (s: string) => {
    for (const b of parseBuildings(s)) {
      const t = tileOf(b), k = `${t.x}_${t.y}`, a = pend.get(k) ?? pend.set(k, []).get(k)!, n0 = a.length;
      a.push(b.rings.length); for (const rs of b.rings) { a.push(rs.length); for (const r of rs) a.push(r.length, ...r); }
      held += a.length - n0;
    }
    if (held > 4_000_000) await flush(held > 8_000_000);
  };
  const dec = new TextDecoder(); let tail = "";
  for await (const c of createReadStream(zip, { start }).pipe(createInflateRaw()) as AsyncIterable<Buffer>) {
    const [whole, rest] = splitBuildings(tail + dec.decode(c, { stream: true })); tail = rest; if (whole) await take(whole);
  }
  await take(tail); await flush(true);
  for (const f of await readdir(dir)) if (f.endsWith(".bin")) await unlink(path.join(dir, f)).catch(() => {});
  const keys = await readdir(tmp);
  for (const k of keys) {
    const b = await readFile(path.join(tmp, k)), f = new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8), bs: Bld[] = [];
    for (let i = 0; i < f.length;) { const np = f[i++], rings: number[][][] = []; for (let p = 0; p < np; p++) { const nr = f[i++], rs: number[][] = []; for (let r = 0; r < nr; r++) { const L = f[i++]; rs.push(Array.from(f.subarray(i, i + L))); i += L; } rings.push(rs); } bs.push({ id: "", rings }); }
    const [x, y] = k.split("_").map(Number); await writeStore(path.join(dir, `${k}.bin`), encodeMesh(buildMesh(bs, x, y)));
  }
  await rm(tmp, { recursive: true, force: true });
  const tiles = { size: keys.length };
  await writeStore(doneFile(dir), JSON.stringify({ v: STORE_V, at: Date.now(), tiles: tiles.size }));
  await unlink(zip).catch(() => {}); // the tiles are all we need; a refresh downloads again
}
const failed = new Map<string, number>(); // a failed download waits 10 minutes before the next try
export function ensureMuni(root: string, muni: string, get: Fetcher): Promise<void> {
  const k = `${root}|${muni}`;
  if ((failed.get(k) ?? 0) > Date.now()) return Promise.reject(new Error(`LOD2 ${muni}: waiting after a failure`));
  if (!busy.has(k)) busy.set(k, (async () => { if (!(await fresh(path.join(root, muni)))) await bucket(root, muni, get); })()
    .catch((e) => { failed.set(k, Date.now() + 600_000); throw e; }).finally(() => busy.delete(k)));
  return busy.get(k)!;
}
/** The tile's mesh, or "pending" while a municipality it needs is still being prepared (the first visit there). */
export async function tileMesh(root: string, x: number, y: number, get: Fetcher, wait = false): Promise<EMesh | "pending" | null> {
  const ms = munisFor(x, y), parts: EMesh[] = [];
  const stale = (await Promise.all(ms.map((m) => fresh(path.join(root, m))))).map((f, i) => (f ? null : ms[i])).filter((m): m is string => !!m);
  if (stale.length) {
    const jobs = stale.map((m) => ensureMuni(root, m, get)); // started, not awaited: the first visit answers "pending" at once
    if (!wait) { jobs.forEach((j) => j.catch(() => {})); return "pending"; }
    await Promise.all(jobs);
  }
  for (const m of ms) { try { const d = decodeMesh(await readFile(path.join(root, m, `${x}_${y}.bin`))); if (d && d.nB) parts.push(d); } catch { /* no buildings of m here */ } }
  return mergeMeshes(parts);
}
export const emptyMesh = (x: number, y: number) => encodeMesh(buildMesh([], x, y));
