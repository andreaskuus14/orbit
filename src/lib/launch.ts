import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchPage } from "./memory";
import { nicheBoard, shopDir } from "./niche";
import { isNicheId } from "./niche-pure";
import { DOCS, FILES, PLATFORMS, buildPackage, checkDoc, isPlatform, type DocCheck, type LaunchPackage, type Platform } from "./launch-pure";

// BUSINESS store launch package (roadmap B5): files in <data>/business/shops/<niche id>/launch-<platform>/. Logic: launch-pure.ts.
// The only outside call is a read-only GET of the platform's own CSV/listing doc (memory.ts safeFetch: SSRF-guarded, capped).
// Nothing is uploaded, imported, posted or generated here.

const dir = (id: string, p: Platform) => path.join(shopDir(id), `launch-${p}`);

/** Re-read the platform's doc page and report column names it no longer mentions. A fetch failure doesn't block the package. */
async function verifyDoc(p: Platform): Promise<DocCheck> {
  const { url, names } = DOCS[p], at = new Date().toISOString();
  try {
    const page = await fetchPage(url);
    const missing = checkDoc(page.text, names);
    return { url, at, ok: !missing.length, missing };
  } catch (e) {
    return { url, at, ok: false, missing: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

export async function buildLaunch(id: string, platform: Platform): Promise<LaunchPackage> {
  const b = await nicheBoard();
  const n = b.niches.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  if (n.status !== "kept") throw new Error("Keep the idea first");
  const kit = b.kits[id];
  if (!kit) throw new Error("Build the shop first: the launch package uses its kit");
  const { pkg, files } = buildPackage(platform, n, kit, await verifyDoc(platform), new Date().toISOString());
  const d = dir(id, platform);
  await mkdir(d, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(d, name), body);
  await writeFile(path.join(d, "launch.json"), JSON.stringify(pkg, null, 1));
  return pkg;
}

/** Saved packages for one niche, by platform. */
export async function readLaunches(id: string): Promise<Partial<Record<Platform, LaunchPackage>>> {
  const out: Partial<Record<Platform, LaunchPackage>> = {};
  if (!isNicheId(id)) return out;
  for (const p of PLATFORMS) {
    const raw = await readFile(path.join(dir(id, p), "launch.json"), "utf8").catch(() => null);
    if (raw) out[p] = JSON.parse(raw) as LaunchPackage;
  }
  return out;
}

/** One saved file for download; only names from FILES (no path from the request reaches the disk). */
export async function readLaunchFile(id: string, platform: unknown, name: unknown): Promise<{ name: string; body: string } | null> {
  if (!isNicheId(id) || !isPlatform(platform) || typeof name !== "string" || !FILES[platform].includes(name)) return null;
  const body = await readFile(path.join(dir(id, platform), name), "utf8").catch(() => null);
  return body === null ? null : { name, body };
}

/** The stored prompt for image #index, for a Higgsfield quote: the prompt text comes from disk, never from the request. */
export async function launchImage(id: string, platform: unknown, index: unknown) {
  if (!isPlatform(platform) || !Number.isInteger(index)) return null;
  return (await readLaunches(id))[platform]?.images[index as number] ?? null;
}
