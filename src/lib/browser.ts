import { lookup } from "node:dns/promises";
import { isPrivateIp } from "./pure";

// Hidden real browser for pages that only show content after JavaScript runs. Uses the Chrome (or Edge)
// already installed on this PC via playwright-core: nothing extra is downloaded. Every session is a fresh,
// cookie-less profile, so it is never logged in anywhere. Requests to private/local addresses are blocked.

type Browser = import("playwright-core").Browser;
const g = globalThis as unknown as { __orbitBrowser?: Promise<Browser | null>; __orbitBrowserIdle?: NodeJS.Timeout };
const IDLE_MS = 2 * 60_000;
const hostOk = new Map<string, boolean>();

async function allowedHost(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return false;
  if (/^[\d.]+$/.test(h) || h.includes(":")) return !isPrivateIp(h);
  const cached = hostOk.get(h);
  if (cached !== undefined) return cached;
  let ok = false;
  try { ok = (await lookup(h, { all: true })).every((a) => !isPrivateIp(a.address)); } catch { ok = false; }
  if (hostOk.size > 2000) hostOk.clear();
  hostOk.set(h, ok);
  return ok;
}

// Quiet, minimal browser: no sync, updates, telemetry or extensions.
const ARGS = ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-first-run", "--mute-audio"];

async function launch(): Promise<Browser | null> {
  let chromium: typeof import("playwright-core").chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { return null; } // not installed: plain fetch only
  if (process.env.ORBIT_BROWSER_PATH) {
    try { return await chromium.launch({ executablePath: process.env.ORBIT_BROWSER_PATH, headless: true, args: ARGS }); }
    catch (e) { console.warn("[orbit] ORBIT_BROWSER_PATH didn't start:", e instanceof Error ? e.message : e); }
  }
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true, args: ARGS }); } catch { /* try the next browser */ }
  }
  console.warn("[orbit] hidden browser unavailable: Chrome or Edge not found");
  return null;
}

function getBrowser() {
  if (g.__orbitBrowserIdle) clearTimeout(g.__orbitBrowserIdle);
  g.__orbitBrowserIdle = setTimeout(async () => {
    const b = await g.__orbitBrowser;
    g.__orbitBrowser = undefined;
    await b?.close().catch(() => {});
  }, IDLE_MS);
  g.__orbitBrowser ??= launch().then((b) => { b?.on("disconnected", () => { g.__orbitBrowser = undefined; }); return b; });
  return g.__orbitBrowser;
}

/** Load a public page in the hidden browser and return its final URL and HTML (null if unavailable or blocked). */
export async function renderPage(url: string, userAgent: string): Promise<{ url: string; html: string; text: string } | null> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || !(await allowedHost(u.hostname))) return null;
  let browser = await getBrowser();
  // Don't stick with a failed launch (e.g. Chrome or playwright-core installed later): try once more.
  if (!browser) { g.__orbitBrowser = undefined; browser = await getBrowser(); }
  if (!browser) return null;
  const ctx = await browser.newContext({ userAgent, acceptDownloads: false, locale: "en-US", serviceWorkers: "block" });
  try {
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      // Skip heavy assets; block anything aimed at this PC or the home network.
      if (["image", "media", "font"].includes(req.resourceType())) return route.abort();
      let host = "";
      try { host = new URL(req.url()).hostname; } catch { return route.abort(); }
      return (await allowedHost(host)) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {}); // good enough if it never idles
    return { url: page.url(), html: await page.content(), text: (await page.innerText("body").catch(() => "")).slice(0, 200_000) };
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
