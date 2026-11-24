import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { byCountry, parseGeoNames, type City } from "./earth-region-pure";

// GeoNames cities15000 (CC BY 4.0, "GeoNames, geonames.org"): downloaded once (~3 MB zip), split per country into
// .cache/earth/geonames/<CC>.json plus a small index for "which country is under the camera". Countries load lazily.
const DIR = path.join(process.cwd(), ".cache", "earth", "geonames");
const SRC = "https://download.geonames.org/export/dump/cities15000.zip";
const TTL = 90 * 24 * 3600_000;
type Idx = { cc: string; lon: number; lat: number }[];
type Mem = { index?: Promise<Idx>; cc: Map<string, City[]> };
const g = globalThis as unknown as { __orbitGeo?: Mem };
const mem: Mem = (g.__orbitGeo ??= { cc: new Map<string, City[]>() });

/** The one text file inside a zip (stored or deflated), read from its central directory. */
export function unzipFirst(buf: Buffer): Buffer {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip");
  const cd = buf.readUInt32LE(e + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("bad zip");
  const method = buf.readUInt16LE(cd + 10), size = buf.readUInt32LE(cd + 20), off = buf.readUInt32LE(cd + 42);
  const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}

async function build(): Promise<Idx> {
  const idx = path.join(DIR, "index.json");
  try { const s = await stat(idx); if (Date.now() - s.mtimeMs < TTL) return JSON.parse(await readFile(idx, "utf8")); } catch { /* not built yet */ }
  try {
    const r = await fetch(SRC, { headers: { "User-Agent": "ORBIT/0.2" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(String(r.status));
    const cities = parseGeoNames(unzipFirst(Buffer.from(await r.arrayBuffer())).toString("utf8"));
    await mkdir(DIR, { recursive: true });
    const by = byCountry(cities);
    for (const [cc, list] of by) await writeFile(path.join(DIR, `${cc}.json`), JSON.stringify(list));
    const index = cities.filter((c) => c.pop >= 15000).map((c) => ({ cc: c.cc, lon: Math.round(c.lon * 100) / 100, lat: Math.round(c.lat * 100) / 100 }));
    await writeFile(idx, JSON.stringify(index));
    return index;
  } catch {
    try { return JSON.parse(await readFile(idx, "utf8")); } catch { return []; } // offline: an old copy, or nothing (no region news)
  }
}
export function cityIndex(): Promise<Idx> {
  mem.index ??= build().then((x) => { if (!x.length) mem.index = undefined; return x; });
  return mem.index;
}
export async function citiesOf(cc: string): Promise<City[]> {
  if (!/^[A-Z]{2}$/.test(cc)) return [];
  const hit = mem.cc.get(cc);
  if (hit) return hit;
  await cityIndex();
  try { const l = JSON.parse(await readFile(path.join(DIR, `${cc}.json`), "utf8")) as City[]; mem.cc.set(cc, l); return l; } catch { return []; }
}
