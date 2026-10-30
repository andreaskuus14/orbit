// ws_fetch_image: finds a licensed image (Wikimedia Commons, then Openverse; a direct URL only when the owner gave it) and saves it
// into the workspace under assets/, with assets/CREDITS.md. Never scrapes pages; never hotlinks. Pure parts: site-pipeline-pure.ts.
import { assetPath, attributionLine, creditsMd, MAX_IMAGE_BYTES, ownerSupplied, parseCommons, parseCredits, parseOpenverse, sniffImage, unsafeSvg, type Candidate } from "./site-pipeline-pure.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type ImageIO = {
  fetch?: Fetch;
  read: (path: string) => Promise<string | null>;
  write: (path: string, data: string | Uint8Array) => Promise<{ path: string; bytes: number } | { error: string }>;
  resize?: (b: Uint8Array, ext: string) => Promise<{ bytes: Uint8Array; ext: string } | null>;
};
const UA = "ORBIT-site-builder/1.0 (personal, non-commercial; image search via public APIs)";
const get = (f: Fetch, url: string) => f(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });

export async function searchImages(query: string, f: Fetch = fetch): Promise<Candidate[]> {
  const q = encodeURIComponent(query.slice(0, 100));
  const commons = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${q}%20filetype:bitmap&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=1600`;
  const openverse = `https://api.openverse.org/v1/images/?q=${q}&license=cc0,pdm,by,by-sa&page_size=10&mature=false`;
  const out: Candidate[] = [];
  for (const [url, parse] of [[commons, parseCommons], [openverse, parseOpenverse]] as const) {
    try { const r = await get(f, url); if (r.ok) out.push(...parse(await r.json())); } catch { /* one source down: try the next */ }
    if (out.length >= 3) break;
  }
  return out;
}

/** Download with a hard size cap (the body is read in chunks, never past MAX_IMAGE_BYTES). */
async function download(f: Fetch, url: string): Promise<Uint8Array | string> {
  const r = await f(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!r.ok || !r.body) return `download failed (HTTP ${r.status})`;
  if (Number(r.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return "image is over 2 MB";
  const parts: Uint8Array[] = []; let n = 0;
  const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > MAX_IMAGE_BYTES) { await rd.cancel().catch(() => {}); return "image is over 2 MB"; }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** Resize to ≤1600 px wide and re-encode as WebP (photos) when sharp loads; null = keep the original. */
export async function sharpResize(b: Uint8Array, ext: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (ext === "svg") return null;
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(b, { limitInputPixels: 50_000_000 }).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return out.length < b.length || ext !== "webp" ? { bytes: out, ext: "webp" } : null;
  } catch { return null; }
}

export async function fetchImage(input: Record<string, unknown>, question: string, io: ImageIO): Promise<string> {
  const f = io.fetch ?? fetch;
  const purpose = typeof input.purpose === "string" ? input.purpose.trim().slice(0, 80) : "";
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 100) : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!query && !url) return "Error: give a query (what the picture shows) or a url the user gave";
  let cands: Candidate[];
  if (url) {
    if (!ownerSupplied(url, question)) return "Error: a direct url is allowed only when the user gave that exact link in his message; search with a query instead (licensed sources only)";
    cands = [{ url, title: purpose || "Image", author: "Supplied by the owner", license: { label: "owner-supplied", attribution: false }, source: url, via: "Owner-supplied" }];
  } else cands = await searchImages(query, f);
  if (!cands.length) return `No licensed image found for "${query}". Try ws_inspire_image (an original picture generated from your own brief, after the owner approves), or draw an inline SVG illustration.`;
  const tried: string[] = [];
  for (const c of cands.slice(0, 4)) {
    let data: Uint8Array | string;
    try { data = await download(f, c.url); } catch (e) { tried.push(`${c.title}: ${e instanceof Error ? e.message : "error"}`); continue; }
    if (typeof data === "string") { tried.push(`${c.title}: ${data}`); continue; }
    let ext: string | null = sniffImage(data);
    if (!ext) { tried.push(`${c.title}: not a jpg/png/webp/svg`); continue; }
    if (ext === "svg" && unsafeSvg(new TextDecoder().decode(data))) { tried.push(`${c.title}: SVG with scripts or outside links`); continue; }
    const small = await (io.resize ?? sharpResize)(data, ext);
    if (small) ({ bytes: data, ext } = small);
    const path = assetPath(purpose || query || c.title, ext);
    const w = await io.write(path, ext === "svg" ? new TextDecoder().decode(data) : data);
    if ("error" in w) return `Error: ${w.error}`;
    const credits = parseCredits((await io.read("assets/CREDITS.md")) ?? "");
    const entry = { path, title: c.title, author: c.author, license: c.license.label, attribution: c.license.attribution, source: c.source, via: c.via };
    const cw = await io.write("assets/CREDITS.md", creditsMd(credits, entry));
    if ("error" in cw) return `Error: saved ${path} but assets/CREDITS.md failed (${cw.error}); don't use the image`;
    const foot = attributionLine([...credits.filter((x) => x.path !== path), entry]);
    return `Done: saved ${path} (${Math.round(w.bytes / 1024)} KB, ${c.license.label}, ${c.via}). Use it as <img src="${path}" alt="…"> (relative to index.html). Credit recorded in assets/CREDITS.md.${foot ? `\nThe license requires credit: put this line in the site footer: ${foot}` : ""}`;
  }
  return `No usable licensed image for "${query || url}" (${tried.slice(0, 3).join("; ")}). Try ws_inspire_image (an original picture generated from your own brief, after the owner approves), or draw an inline SVG illustration.`;
}
