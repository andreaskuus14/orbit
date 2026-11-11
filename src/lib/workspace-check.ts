import { writeFile } from "node:fs/promises";
import path from "node:path";
import { checkDir, listFiles, readWsFile } from "./workspace.ts";
import { PREVIEW_HEADERS, checkPath, contentType, previewPath } from "./workspace-pure.ts";
import { type CheckReport, type Probe, staticIssues, summarize } from "./workspace-check-pure.ts";

// "Check before showing": after CORE writes a site, render index.html headlessly (the Chrome/Edge playwright-core finds, as in
// browser.ts) at desktop and phone width, collect errors, 404s, overflow, broken images and text contrast, and save two screenshots
// + the verdict in <workspace>/.orbit-check. The page runs like the preview: same CSP sandbox headers, only the workspace's own
// files (served from disk via route()), every other request aborted. No browser → static checks only.

// The page sits under a folder like the real /w/<seg>/ link, so a root path ("/style.css") misses here just as it does there.
const ORIGIN = "http://orbit-check.invalid", BASE = "/w/check/";
const VIEWS = [{ name: "desktop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 844 }] as const;
// No DNS, no direct UDP (WebRTC), and a dead proxy: even a request that slipped past route() can't reach the network.
const ARGS = ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-first-run", "--mute-audio",
  "--host-resolver-rules=MAP * ~NOTFOUND", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];
const KILL_MS = 60_000; // a busy-looping page can't hold the check (or CORE's turn) longer than this

type Browser = import("playwright-core").Browser;
/** Headless Chromium with no network (also used by site-qa.ts), or null when none is installed. */
export async function launch(): Promise<Browser | null> {
  let chromium: typeof import("playwright-core").chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { return null; }
  const tries = [
    ...(process.env.ORBIT_BROWSER_PATH ? [{ executablePath: process.env.ORBIT_BROWSER_PATH }] : []),
    { channel: "chrome" }, { channel: "msedge" }, {}, // {} = playwright's own Chromium, if one was ever installed
  ];
  for (const t of tries) {
    for (const chromiumSandbox of [true, false]) { // OS sandbox first; without it only if this browser won't start sandboxed
      try { return await chromium.launch({ ...t, chromiumSandbox, headless: true, args: ARGS, proxy: { server: "http://127.0.0.1:9" }, timeout: 20_000 }); } catch { /* next */ }
    }
  }
  return null;
}

// Runs in the page: what summarize() needs at this viewport. Kept as plain DOM code (no closures) for page.evaluate.
export function probePage(): Probe {
  const de = document.documentElement, body = document.body;
  const visible = (el: Element) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0"; };
  const badImgs = [...document.images].filter((i) => (i.checkVisibility ? i.checkVisibility() : getComputedStyle(i).display !== "none") && (!i.complete || !i.naturalWidth || !i.getBoundingClientRect().width || !i.getBoundingClientRect().height)).map((i) => i.getAttribute("src") || "(no src)");
  const media = [...document.querySelectorAll("img,svg,canvas,video,button,input")].filter(visible).length;
  const samples: Probe["samples"] = [];
  const walker = document.createTreeWalker(body ?? de, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n && samples.length < 300; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent?.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !visible(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    let bgLayers: string[] | null = [];
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.backgroundImage !== "none") { bgLayers = null; break; } // text on an image/gradient: can't judge from colours
      bgLayers.push(s.backgroundColor);
      if (/^rgb\(/.test(s.backgroundColor)) break; // opaque
    }
    samples.push({ fg: cs.color, bgLayers, px: parseFloat(cs.fontSize) || 16, bold: Number(cs.fontWeight) >= 700, text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 60) });
  }
  const clips = (el: Element | null) => !!el && /^(?:hidden|clip)$/.test(getComputedStyle(el).overflowX);
  return { vw: window.innerWidth, clipX: clips(de) || clips(body), scrollWidth: Math.max(de.scrollWidth, body?.scrollWidth ?? 0), textLen: (body?.innerText ?? "").trim().length, media, badImgs, samples };
}

/** Scroll through once like a visitor so loading="lazy" images load (else they'd count as broken), then back to the top. */
export async function loadLazy(p: import("playwright-core").Page): Promise<void> {
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 40)); } scrollTo({ top: 0, behavior: "instant" }); });
  await p.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});
  // decoded, so screenshots paint them; capped, because decode() never settles for a lazy image that's hidden (display: none) and so never loads
  await p.evaluate(() => Promise.all([...document.images].map((i) => Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]))));
}

// One check (one browser) at a time.
let queue: Promise<unknown> = Promise.resolve();
/** Check a workspace's site; saves screenshots + result.json in .orbit-check. null = no index.html to check. */
export function checkSite(uid: string, slug: string, page = "index.html"): Promise<CheckReport | null> {
  const run = queue.catch(() => {}).then(() => runCheck(uid, slug, page));
  queue = run;
  return run;
}

async function runCheck(uid: string, slug: string, page: string): Promise<CheckReport | null> {
  const [entry, files, dir] = await Promise.all([readWsFile(uid, slug, page), listFiles(uid, slug), checkDir(uid, slug)]);
  if (!entry || !files || !dir) return null;
  const statics = staticIssues(entry.text, page, new Set(files.map((f) => f.path)));
  const errors: string[] = [], missing = new Set<string>(), probes: Partial<Record<"desktop" | "phone", Probe>> = {}, shots: string[] = [];
  const browser = await launch();
  if (browser) {
    const kill = setTimeout(() => { errors.push(`check stopped after ${KILL_MS / 1000} s (page busy or hung)`); void browser.close().catch(() => {}); }, KILL_MS);
    try {
      const ctx = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", locale: "en-US" });
      await ctx.route("**/*", async (route) => {
        let u: URL;
        try { u = new URL(route.request().url()); } catch { return route.abort(); }
        if (u.origin !== ORIGIN) return route.abort("blockedbyclient"); // the preview's CSP blocks these too; staticIssues names them
        const rel = u.pathname.startsWith(BASE) ? previewPath(u.pathname.slice(BASE.length).split("/")) : null;
        const f = rel && !("error" in checkPath(rel)) ? await readWsFile(uid, slug, rel) : null;
        if (!f) {
          if (rel && rel !== "favicon.ico") missing.add(rel);
          return route.fulfill({ status: 404, headers: { ...PREVIEW_HEADERS, "Content-Type": "text/plain; charset=utf-8" }, body: "Not found" });
        }
        return route.fulfill({ status: 200, headers: { ...PREVIEW_HEADERS, "Content-Type": contentType(rel!) }, body: Buffer.from(f.bytes) });
      });
      for (const v of VIEWS) {
        const p = await ctx.newPage();
        p.on("pageerror", (e) => errors.push(`uncaught ${e.message}`));
        // CSP "Refused to load" lines repeat staticIssues' external-URL finding and a 404 line repeats `missing`.
        p.on("console", (m) => { if (m.type() === "error" && !/Refused to (?:load|connect)|status of 404|ERR_BLOCKED_BY_CLIENT|MIME type \('text\/plain'\)/.test(m.text())) errors.push(m.text()); });
        await p.setViewportSize({ width: v.width, height: v.height });
        try {
          await p.goto(ORIGIN + BASE + page.split("/").map(encodeURIComponent).join("/"), { waitUntil: "load", timeout: 15_000 });
          await p.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
          await loadLazy(p);
          probes[v.name] = await p.evaluate(probePage);
          await p.screenshot({ path: path.join(dir, `${v.name}.png`), timeout: 10_000 });
          shots.push(v.name);
        } catch (e) {
          errors.push(`${v.name} render failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
        } finally {
          await p.close().catch(() => {});
        }
      }
    } catch (e) {
      errors.push(`render failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    } finally {
      clearTimeout(kill);
      await browser.close().catch(() => {});
    }
  }
  const { line, issues } = summarize({ statics, errors: [...new Set(errors)].slice(0, 8), missing: [...missing], ...probes, rendered: !!browser });
  const report: CheckReport = { at: new Date().toISOString(), rendered: !!browser, line, issues, shots };
  await writeFile(path.join(dir, "result.json"), JSON.stringify(report));
  return report;
}
