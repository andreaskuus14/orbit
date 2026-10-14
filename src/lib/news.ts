import { safeFetch } from "./memory";
import { decodeGoogleNewsId, extractArticle, extractLinks } from "./pure";
import { renderPage } from "./browser";

// Turning news links into readable full articles. Google News RSS wraps every link in a news.google.com
// redirect; we unwrap it (old ids decode locally, new ids go through the same endpoint Google's own page uses).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const g = globalThis as unknown as { __orbitGnCache?: Map<string, string> };
const cache = (g.__orbitGnCache ??= new Map());

async function viaGoogleApi(id: string): Promise<string | null> {
  // shortcut: relies on Google's undocumented "garturlreq" call (as used by its own article page); if Google
  // changes it, links stay as Google redirects and briefings fall back to headlines. Revisit if that happens.
  const page = await fetch(`https://news.google.com/articles/${id}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  const html = await page.text();
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) return null;
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sig]);
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA },
    body: `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const chunk = text.split("\n\n")[1];
  if (!chunk) return null;
  const url = JSON.parse(JSON.parse(chunk)[0][2])[1];
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

/** The publisher's own URL for a Google News link (or the input unchanged for any other link). */
export async function resolveNewsUrl(url: string): Promise<string> {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.hostname !== "news.google.com") return url;
  const id = u.pathname.match(/\/(?:rss\/)?articles\/([^/?#]+)/)?.[1];
  if (!id) return url;
  const hit = cache.get(id);
  if (hit) return hit;
  let real: string | null = null;
  const local = decodeGoogleNewsId(id);
  if (local.url) real = local.url;
  else {
    try { real = await viaGoogleApi(id); } catch { real = null; }
  }
  if (real) { cache.set(id, real); if (cache.size > 5000) cache.clear(); }
  return real ?? url;
}

/** Full text of a web page or news article (main content only). Plain download first; if that gets
 *  nothing readable (JavaScript-built page, bot wall), the hidden browser loads it. Null if both fail. */
export type Page = { url: string; title: string; text: string; links: { text: string; url: string }[] };
export async function readArticle(url: string, maxChars = 4000, useBrowser = true): Promise<Page | null> {
  let real = url;
  let plain: Page | null = null;
  try {
    real = await resolveNewsUrl(url);
    if (new URL(real).hostname === "news.google.com") return null;
    const { res, url: finalUrl } = await safeFetch(real, "text/html", UA);
    if ((res.headers.get("content-type") ?? "").includes("html")) {
      const html = (await res.text()).slice(0, 3_000_000);
      const art = extractArticle(html, maxChars);
      if (art.text.length >= 300) plain = { url: finalUrl.toString(), title: art.title, text: art.text, links: extractLinks(html, finalUrl.toString()) };
    }
  } catch {
    /* fall through to the browser */
  }
  // A short plain result is often just a nav bar or cookie notice around a JavaScript-built page: try the browser too.
  if (!useBrowser || (plain && plain.text.length >= Math.min(1500, maxChars))) return plain;
  const page = await renderPage(real, UA);
  if (!page) return plain;
  const art = extractArticle(page.html, maxChars);
  // Some apps (charts, dashboards) don't use paragraphs at all: fall back to the visible text.
  const visible = page.text.replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
  const text = art.text.length >= Math.min(1500, maxChars) || art.text.length >= visible.length ? art.text : visible;
  if (text.length < 150 || (plain && plain.text.length >= text.length)) return plain;
  return { url: page.url, title: art.title, text, links: extractLinks(page.html, page.url) };
}
