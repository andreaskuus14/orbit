// The rich INTELLIGENCE briefing (owner 23 Nov: "not detailed at all… should look crazy"): pictures, places, read time, a
// breaking ticker and "Near you". Everything here is pure; the picture fetch lives in app/api/news/thumb (robots.txt,
// safeFetch, disk cache) and the panel draws the rest.
import { COUNTRIES, displayName, geoTag } from "./geo.ts";

/* ---------- article pictures ---------- */

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** The article's share picture: og:image (secure_url / url first), then twitter:image, then <link rel="image_src">. Absolute
 *  http(s) URL or null. Only the <head> part is read. */
export function ogImageOf(html: string, base: string): string | null {
  const head = html.slice(0, 200_000).split(/<\/head>/i)[0];
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const val = (tag: string, name: string) => { const m = attr(tag, name); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null; };
  const find = (key: string) => metas.find((t) => (val(t, "property") ?? val(t, "name") ?? "").toLowerCase() === key);
  const order = ["og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src"];
  let raw: string | null = null;
  for (const k of order) { const t = find(k); const c = t && val(t, "content"); if (c) { raw = c; break; } }
  if (!raw) { const l = head.match(/<link\b[^>]*rel\s*=\s*["']?image_src["']?[^>]*>/i)?.[0]; raw = l ? val(l, "href") : null; }
  if (!raw) return null;
  try { const u = new URL(raw, base); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; }
}

/** Picture types we pass to the browser. No SVG (it can carry script). */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"] as const;
export const imageType = (ct: string | null | undefined): string | null => {
  const t = (ct ?? "").split(";")[0].trim().toLowerCase();
  return (IMAGE_TYPES as readonly string[]).includes(t) ? t : null;
};

/** Sites the owner doesn't want pictures from (ORBIT_THUMB_BLOCK=a.com,b.org) plus a robots verdict. */
export function thumbAllowed(url: string, block: string | undefined): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  return !(block ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^\./, "")).filter(Boolean).some((d) => host === d || host.endsWith(`.${d}`));
}

/** One cache entry: a picture, or a remembered miss (so a site without one isn't asked again for a day). */
export type ThumbMeta = { at: number; type: string | null };
export const THUMB_TTL = 7 * 86_400_000, MISS_TTL = 86_400_000;
export const thumbFresh = (m: ThumbMeta | null, now: number) => !!m && now - m.at < (m.type ? THUMB_TTL : MISS_TTL);

/* ---------- read time, places, breaking, near you ---------- */

/** Minutes to read `words` words at 220 a minute, at least 1. */
export const readMinutes = (text: string) => Math.max(1, Math.round((text.match(/\S+/g)?.length ?? 0) / 220));

export type Place = { name: string; label: string; lat: number; lon: number; city?: string };
const CITIES: Record<string, { country: string; lat: number; lon: number }> = {
  Tallinn: { country: "Estonia", lat: 59.437, lon: 24.754 }, Tartu: { country: "Estonia", lat: 58.378, lon: 26.729 }, Pärnu: { country: "Estonia", lat: 58.385, lon: 24.497 },
  Narva: { country: "Estonia", lat: 59.377, lon: 28.19 }, Helsinki: { country: "Finland", lat: 60.17, lon: 24.94 }, Riga: { country: "Latvia", lat: 56.95, lon: 24.11 },
};

/** Where a story is: a known city when named, else the strongest country (geo.ts gazetteer). null when it names no place. */
export function placeOf(text: string): Place | null {
  for (const [city, c] of Object.entries(CITIES)) if (new RegExp(`\\b${city}\\b`).test(text)) return { name: c.country, label: city, lat: c.lat, lon: c.lon, city };
  const name = geoTag(text, "", 1)[0];
  const c = name ? COUNTRIES.find((x) => x.name === name) : undefined;
  return c ? { name: c.name, label: displayName(c.name), lat: c.lat, lon: c.lon } : null;
}

/** The owner's home for "Near you". */
export const HOME = { city: "Tallinn", country: "Estonia" } as const;

type Art = { id: string; title: string; url: string; source: string | null; published_at: string | null };
const time = (a: { published_at: string | null }) => (a.published_at ? Date.parse(a.published_at) || 0 : 0);
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Local stories: articles about the home country, ones naming the home city first, then newest. Same headline once. */
export function nearYou<A extends Art>(articles: A[], home: { city: string; country: string } = HOME, max = 4): (A & { place: Place })[] {
  const seen = new Set<string>(), out: (A & { place: Place; city: boolean })[] = [];
  for (const a of articles) {
    const p = placeOf(a.title);
    if (!p || p.name !== home.country || seen.has(norm(a.title))) continue;
    seen.add(norm(a.title)); out.push({ ...a, place: p, city: p.city === home.city });
  }
  return out.sort((a, b) => Number(b.city) - Number(a.city) || time(b) - time(a)).slice(0, max).map(({ city: _c, ...a }) => a as A & { place: Place });
}

/** The ticker: reports from the last `hours`, newest first, one per headline. Falls back to the newest few when nothing is that fresh. */
export function breaking<A extends Art>(articles: A[], now: number, hours = 3, max = 8): { items: A[]; fresh: boolean } {
  const seen = new Set<string>();
  const uniq = [...articles].filter((a) => time(a) <= now).sort((a, b) => time(b) - time(a)).filter((a) => !seen.has(norm(a.title)) && !!seen.add(norm(a.title)));
  const fresh = uniq.filter((a) => now - time(a) < hours * 3_600_000);
  return fresh.length ? { items: fresh.slice(0, max), fresh: true } : { items: uniq.slice(0, Math.min(4, max)), fresh: false };
}

/** "12 min" / "3 h" / "2 d" for a report time. */
export function ago(iso: string | null, now: number): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 60 ? `${Math.max(1, m)} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/** Two letters for a source badge when its icon can't load: "BBC World" → "BW", "ERR News" → "EN", "techcrunch" → "TE". */
export const initials = (s: string | null | undefined) => {
  const w = (s ?? "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "?").slice(0, 2)).toUpperCase();
};

/** A stable hue (0-359) per source, for the picture fallback. */
export const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

/* ---------- mini map: land outlines around a point (world-atlas land-110m TopoJSON) ---------- */

type Topo = { transform: { scale: [number, number]; translate: [number, number] }; arcs: number[][][]; objects: Record<string, { geometries: { type: string; arcs: number[][] | number[][][] }[] }> };
let decoded: { topo: Topo; arcs: [number, number][][] } | null = null;
function arcsOf(topo: Topo) {
  if (decoded?.topo === topo) return decoded.arcs;
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty] as [number, number]; }); });
  decoded = { topo, arcs };
  return arcs;
}

/** SVG path of the land within `span` degrees (longitude) of a point, fitted to a w×h box (equirectangular, longitude squeezed
 *  by cos(lat) so shapes look right), plus where the point sits. Rings fully outside the box are dropped. */
export function miniMap(topo: Topo, lat: number, lon: number, w: number, h: number, span = 24): { d: string; x: number; y: number } {
  const arcs = arcsOf(topo), k = Math.cos((lat * Math.PI) / 180) || 1;
  const sc = w / span, spanY = h / sc;
  const px = (p: [number, number]) => [(p[0] - lon) * k * sc + w / 2, (lat - p[1]) * sc + h / 2] as const;
  const ring = (ids: number[]) => ids.flatMap((i) => { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; return a; });
  const out: string[] = [];
  for (const g of Object.values(topo.objects)[0].geometries) {
    const polys = (g.type === "Polygon" ? [g.arcs] : g.arcs) as number[][][];
    for (const poly of polys) for (const r of poly) {
      const pts = ring(r);
      if (!pts.some(([x, y]) => Math.abs((x - lon) * k) < span && Math.abs(y - lat) < spanY)) continue;
      out.push("M" + pts.map((p) => px(p).map((v) => v.toFixed(1)).join(",")).join("L") + "Z");
    }
  }
  return { d: out.join(""), x: w / 2, y: h / 2 };
}
