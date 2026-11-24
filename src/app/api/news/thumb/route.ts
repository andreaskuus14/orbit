// Article pictures and source icons for the INTELLIGENCE briefing. GET ?u=<article url>&kind=image|icon.
// image: the web ladder's fetch rung (safeFetch: SSRF guard, size cap, same browser UA) reads the page head for og:image, then
// the picture itself; icon: the site's /favicon.ico. robots.txt is respected for the page and the picture, sites in
// ORBIT_THUMB_BLOCK are skipped, SVG is never served. Cached on disk 7 days (a miss is remembered 1 day). Nothing private is sent:
// only the public article URL. 404 = no picture; the panel draws its own fallback.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { orbitDataDir } from "@/lib/data-dir";
import { writeStore } from "@/lib/safe-file";
import { safeFetch } from "@/lib/memory";
import { UA } from "@/lib/web-ladder";
import { robotsAllows } from "@/lib/scrape-pure";
import { imageType, ogImageOf, thumbAllowed, thumbFresh, type ThumbMeta } from "@/lib/intel-rich-pure";

const dir = path.join(orbitDataDir(), "news-thumbs");
const robotsCache = new Map<string, { at: number; text: string }>();

async function robotsOk(u: URL): Promise<boolean> {
  let r = robotsCache.get(u.origin);
  if (!r || Date.now() - r.at > 6 * 3_600_000) {
    let text = "";
    try { const { res } = await safeFetch(`${u.origin}/robots.txt`, "text/plain", UA, 300_000, 5_000); text = await res.text(); } catch { /* none = no rules */ }
    r = { at: Date.now(), text }; robotsCache.set(u.origin, r);
  }
  return robotsAllows(r.text, u.pathname + u.search);
}

async function fetchImage(raw: string): Promise<{ type: string; body: Uint8Array } | null> {
  const u = new URL(raw);
  if (!thumbAllowed(raw, process.env.ORBIT_THUMB_BLOCK) || !(await robotsOk(u))) return null;
  const { res, body } = await safeFetch(raw, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", UA, 2_500_000, 8_000);
  const type = imageType(res.headers.get("content-type"));
  return type && body.length > 0 ? { type, body } : null;
}

async function resolve(article: string, kind: "image" | "icon"): Promise<{ type: string; body: Uint8Array } | null> {
  const a = new URL(article);
  if (kind === "icon") return fetchImage(`${a.origin}/favicon.ico`);
  if (!(await robotsOk(a))) return null;
  const { res, url } = await safeFetch(article, "text/html,application/xhtml+xml", UA, 600_000, 8_000);
  const img = ogImageOf(await res.text(), url.toString());
  return img ? fetchImage(img) : null;
}

export async function GET(req: Request) {
  const { res: denied } = await requireUser();
  if (denied) return denied;
  const q = new URL(req.url).searchParams, u = q.get("u") ?? "", kind = q.get("kind") === "icon" ? "icon" : "image";
  if (!thumbAllowed(u, process.env.ORBIT_THUMB_BLOCK)) return new Response(null, { status: 404 });
  const key = createHash("sha1").update(kind === "icon" ? `icon:${new URL(u).origin}` : `image:${u}`).digest("hex");
  const file = path.join(dir, key), now = Date.now();
  const meta = await readFile(`${file}.json`, "utf8").then((s) => JSON.parse(s) as ThumbMeta).catch(() => null);
  let hit: { type: string; body: Uint8Array } | null = null;
  if (meta && thumbFresh(meta, now)) hit = meta.type ? { type: meta.type, body: await readFile(file).catch(() => new Uint8Array()) } : null;
  else {
    hit = await resolve(u, kind).catch(() => null);
    // tmp + rename (retried while Windows antivirus holds the file): a parallel request never reads half a picture
    if (hit) await writeStore(file, hit.body).catch(() => {});
    await writeStore(`${file}.json`, JSON.stringify({ at: now, type: hit?.type ?? null } satisfies ThumbMeta)).catch(() => {});
  }
  if (!hit || !hit.body.length) return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
  return new Response(Buffer.from(hit.body), { headers: { "Content-Type": hit.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}
