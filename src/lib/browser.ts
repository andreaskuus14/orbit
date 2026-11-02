import { lookup } from "node:dns/promises";
import { isPrivateIp } from "./pure";
import type { Act, El } from "./browse-pure";

// Hidden real browser for pages that only show content after JavaScript runs. Uses the Chrome (or Edge)
// already installed on this PC via playwright-core: nothing extra is downloaded. Every session is a fresh,
// cookie-less profile, so it is never logged in anywhere. Requests to private/local addresses are blocked.

type Browser = import("playwright-core").Browser;
const g = globalThis as unknown as { __orbitBrowser?: Promise<Browser | null>; __orbitBrowserIdle?: NodeJS.Timeout };
const IDLE_MS = 2 * 60_000;
// Short-lived DNS verdicts: Chrome resolves names itself, so a long cache would let a rebinding host flip to a
// private IP after being approved. 30 s keeps per-page lookups cheap without that window staying open.
const HOST_TTL_MS = 30_000;
const hostOk = new Map<string, { ok: boolean; at: number }>();

async function allowedHost(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return false;
  if (/^[\d.]+$/.test(h) || h.includes(":")) return !isPrivateIp(h);
  const cached = hostOk.get(h);
  if (cached && Date.now() - cached.at < HOST_TTL_MS) return cached.ok;
  let ok = false;
  try { ok = (await lookup(h, { all: true })).every((a) => !isPrivateIp(a.address)); } catch { ok = false; }
  if (hostOk.size > 2000) hostOk.clear();
  hostOk.set(h, { ok, at: Date.now() });
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
  for (const channel of ["chrome", "msedge", undefined]) { // undefined = playwright's own Chromium (npx playwright install chromium)
    try { return await chromium.launch({ channel, headless: true, args: ARGS }); } catch { /* try the next browser */ }
  }
  console.warn("[orbit] hidden browser unavailable: Chrome, Edge or Playwright's Chromium not found");
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
    // Redirect hops may bypass route(): never hand back a page that ended up on a private address.
    // shortcut: route() never sees redirect hops, so Chrome may already have requested a private hop; this only stops its content coming back. Pin DNS in Chrome (--host-resolver-rules) if pages ever run untrusted.
    if (!(await allowedHost(new URL(page.url()).hostname))) return null;
    return { url: page.url(), html: await page.content(), text: (await page.innerText("body").catch(() => "")).slice(0, 200_000) };
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ---- CORE's browse tool: render, a few read-only steps (click, search box typing, scroll, wait), text + optional screenshot ----

// Runs in the page: what browse-pure needs to judge an element (plain DOM code for evaluate).
function elInfo(el: Element): El {
  const f = (el as HTMLInputElement).form ?? el.closest("form");
  const lab = (el as HTMLInputElement).labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "";
  return { tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") ?? "").toLowerCase(), role: el.getAttribute("role") ?? "", name: el.getAttribute("name") ?? "", id: el.id,
    placeholder: el.getAttribute("placeholder") ?? "", label: lab.trim().slice(0, 80), text: ((el as HTMLElement).innerText || (el as HTMLInputElement).value || "").trim().slice(0, 80),
    inForm: !!f, formMethod: (f?.getAttribute("method") ?? "get").toLowerCase(), formSearch: !!f && (f.getAttribute("role") === "search" || /search|otsi|[?&/]q=|find/i.test(f.getAttribute("action") ?? "") || !!f.querySelector("input[type=search]")),
    formPassword: !!f?.querySelector("input[type=password]") };
}

export type BrowseOut = { url: string; title: string; text: string; notes: string[]; shot?: Uint8Array } | { needsClick: string } | null;

/** Opens a public page in the hidden browser and runs the checked steps. Read-only: every non-GET request the page makes is
 *  blocked (no form posts, likes or tracking beacons), clicks and typing pass browse-pure's checks first. null = no browser/blocked. */
export async function browsePage(url: string, actions: Act[], screenshot: boolean, stop: () => boolean, hostOk = allowedHost): Promise<BrowseOut> { // hostOk: tests serve a local page
  const { clickRefusal, isSearchBox, searchForm } = await import("./browse-pure");
  const u = new URL(url);
  if (!(await hostOk(u.hostname))) return null;
  let browser = await getBrowser();
  if (!browser) { g.__orbitBrowser = undefined; browser = await getBrowser(); }
  if (!browser) return null;
  const ctx = await browser.newContext({ userAgent: "ORBIT personal assistant (+local)", acceptDownloads: false, locale: "en-US", serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const kill = setTimeout(() => { void ctx.close().catch(() => {}); }, 60_000); // a page can't hold CORE's turn longer than this
  try {
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) return route.abort(); // read-only: nothing is posted anywhere
      if (["media", "font"].includes(req.resourceType()) || (!screenshot && req.resourceType() === "image")) return route.abort();
      let host = "";
      try { host = new URL(req.url()).hostname; } catch { return route.abort(); }
      return (await hostOk(host)) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5_000);
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    const notes: string[] = [];
    for (const a of actions) {
      if (stop()) { notes.push("stopped (Stop-all)"); break; }
      try {
        if ("click" in a) {
          const el = page.locator(a.click).first(), why = clickRefusal(await el.evaluate(elInfo));
          if (why) return { needsClick: `on ${page.url()}: ${why}` };
          await el.click(); notes.push(`clicked ${a.click}`);
        } else if ("type" in a) {
          const el = page.locator(a.type).first(), info = await el.evaluate(elInfo);
          if (!isSearchBox(info)) { notes.push(`didn't type into ${a.type}: ORBIT only types into search boxes`); continue; }
          await el.fill(a.text);
          if (a.enter) { if (info.inForm && !searchForm(info)) return { needsClick: `on ${page.url()}: send the form with "${a.text}"` }; await el.press("Enter"); }
          notes.push(`searched "${a.text}"`);
        } else if ("scroll" in a) {
          await page.evaluate((d) => window.scrollTo(0, d === "top" ? 0 : d === "bottom" ? document.body.scrollHeight : window.scrollY + (d === "up" ? -1 : 1) * window.innerHeight), a.scroll);
          notes.push(`scrolled ${a.scroll}`);
        } else if (typeof a.wait === "number") await page.waitForTimeout(a.wait);
        else { await page.waitForSelector(a.wait, { timeout: 5_000 }); notes.push(`waited for ${a.wait}`); }
        await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
      } catch (e) { notes.push(`step failed (${Object.keys(a)[0]}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 100)})`); }
    }
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
    if (!(await hostOk(new URL(page.url()).hostname))) return null; // a redirect onto a private address: nothing comes back
    return { url: page.url(), title: (await page.title().catch(() => "")).slice(0, 200), text: (await page.innerText("body").catch(() => "")).slice(0, 200_000), notes,
      ...(screenshot && { shot: new Uint8Array(await page.screenshot({ type: "jpeg", quality: 70 })) }) };
  } catch {
    return null;
  } finally {
    clearTimeout(kill);
    await ctx.close().catch(() => {});
  }
}

/** CORE tool browse {url, actions?, screenshot?}. robots.txt and polite per-host gaps/day caps as page watch; Stop-all stops it. */
export async function runBrowseTool(i: Record<string, unknown>): Promise<string> {
  const [{ browseReport, checkBrowse, needsClickText }, { robots }, { robotsGate }, { polite }, { stopAllOn }] = await Promise.all([
    import("./browse-pure"), import("./pagewatch"), import("./pagewatch-pure"), import("./reach/net"), import("./stop-all")]);
  const c = checkBrowse(i);
  const ask = async (what: string) => { (await import("./activity")).logActivity({ area: "core", title: `Needs your click: ${what.slice(0, 160)}`, detail: "ORBIT's browser only reads pages; do this yourself in your own browser if you want it" }); return needsClickText(what); };
  if ("error" in c) return `Error: ${c.error}`;
  if ("needsClick" in c) return ask(c.needsClick);
  if (stopAllOn()) return "Error: ORBIT is paused (Stop-all is on)";
  const blocked = robotsGate(await robots(new URL(c.url).origin), c.url);
  if (blocked) return `Error: ${blocked}`;
  try {
    const r = await polite(c.url, () => browsePage(c.url, c.actions, c.screenshot, stopAllOn));
    if (!r) return "Error: the page couldn't be opened in ORBIT's browser (no Chrome/Edge found, a private address, or it didn't load). Try fetch_url for plain pages.";
    if ("needsClick" in r) return ask(r.needsClick);
    let shot: string | undefined;
    if (r.shot) shot = await (await import("./vault")).saveUpload(new File([r.shot as BlobPart], `browse-${new URL(r.url).hostname}.jpg`, { type: "image/jpeg" })).catch(() => undefined);
    return browseReport({ ...r, shot });
  } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}
