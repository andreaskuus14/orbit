// W02 export QA, browser side: open the exported folder from disk (file://, all network blocked) at 360/390/768/1440 px, measure
// with workspace-check's probe plus a Tab walk and the hero crop, drive the form against its fake receiver, and save one full-page
// screenshot per width. The verdicts are site-qa-pure.ts. Used by scripts/site-demo.ts; no ORBIT account or server needed.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Asset } from "./site-brief-pure.ts";
import { type FormRun, type HeroRun, type KeyboardRun, QA_VIEWPORTS, type QaPacket, type ViewRun, qaPacket } from "./site-qa-pure.ts";
import { launch, loadLazy, probePage } from "./workspace-check.ts";
import { parseColor, type Rgba } from "./workspace-check-pure.ts";

async function walk(dir: string, pre = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), `${pre}${e.name}/`))); else out.push(`${pre}${e.name}`);
  }
  return out;
}

// In-page helpers (plain DOM code, injected before any page script).
const HELPERS = `window.__qaDesc = function (el) { if (!el || el === document.body) return "body"; var t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().replace(/\\s+/g, " ").slice(0, 40); return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (t ? ' "' + t + '"' : ""); };
window.__qaFocusables = function () { return Array.prototype.filter.call(document.querySelectorAll("a[href],button,input,select,textarea,summary,[tabindex]"), function (el) {
  var r = el.getBoundingClientRect(), cs = getComputedStyle(el); return el.tabIndex >= 0 && !el.disabled && !el.closest("[aria-hidden=true],[hidden]") && cs.visibility !== "hidden" && r.width > 0 && r.height > 0; }).map(window.__qaDesc); };
window.__qaClickOnly = function () { return Array.prototype.filter.call(document.querySelectorAll("[onclick]"), function (el) { return el.tabIndex < 0; }).map(window.__qaDesc); };`;

/** QA an exported site folder. shots: folder for <width>.jpg (relative names go into the packet). */
export async function qaExport(dir: string, opts: { version: string; hero?: Asset; shots: string; shotPrefix?: string }): Promise<QaPacket> {
  const files = new Set(await walk(dir)), html = await readFile(path.join(dir, "index.html"), "utf8");
  const views: ViewRun[] = [];
  let form: FormRun | null = null, heroText: Rgba[] = [];
  const browser = await launch();
  if (browser) {
    try {
      const ctx = await browser.newContext({ serviceWorkers: "block", locale: "en-US" });
      await ctx.route("**/*", (r) => (r.request().url().startsWith("file:") ? r.continue() : r.abort("blockedbyclient"))); // offline
      await ctx.addInitScript(HELPERS);
      const url = pathToFileURL(path.join(dir, "index.html")).href;
      for (const vp of QA_VIEWPORTS) {
        const p = await ctx.newPage();
        await p.setViewportSize(vp);
        await p.goto(url, { waitUntil: "load" });
        await loadLazy(p);
        const probe = await p.evaluate(probePage);
        const hero = await p.evaluate((): HeroRun => {
          const img = document.querySelector(".hero-img"), copy = document.querySelector(".hero-copy");
          if (!img || !copy) return null;
          const a = img.getBoundingClientRect(), c = copy.getBoundingClientRect(), [x, y] = getComputedStyle(img).objectPosition.split(" ").map((v) => parseFloat(v) / 100);
          const over = c.top < a.bottom && c.bottom > a.top;
          return { boxW: a.width, boxH: a.height, posX: x, posY: y, copy: over ? [(c.left - a.left) / a.width, (c.right - a.left) / a.width] : null };
        });
        if (vp.width >= 900) heroText = (await p.evaluate(() => [...document.querySelectorAll(".hero-copy h1, .hero-copy p:not(.actions)")].map((e) => getComputedStyle(e).color))).map(parseColor).filter((c): c is Rgba => !!c);
        const focusables: string[] = await p.evaluate("window.__qaFocusables()");
        const reached: string[] = [], noFocusStyle: string[] = [];
        for (let i = 0; i < focusables.length + 3; i++) {
          await p.keyboard.press("Tab");
          const [d, styled] = await p.evaluate(() => {
            const el = document.activeElement as HTMLElement | null, cs = el && getComputedStyle(el);
            return [(window as unknown as { __qaDesc: (e: Element | null) => string }).__qaDesc(el), !!cs && ((cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none")] as const;
          });
          if (!reached.includes(d)) { reached.push(d); if (!styled && d !== "body") noFocusStyle.push(d); }
        }
        const clickOnly: string[] = await p.evaluate("window.__qaClickOnly()");
        const kb: KeyboardRun = { focusables, reached, noFocusStyle, clickOnly };
        const shot = `${opts.shotPrefix ?? ""}${vp.width}.jpg`;
        await p.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: "instant" }); }); // no leftover Tab focus ring in the shot
        await p.screenshot({ path: path.join(opts.shots, `${vp.width}.jpg`), fullPage: true, type: "jpeg", quality: 72 });
        views.push({ vw: vp.width, probe, keyboard: kb, hero, shot });
        if (vp.width === 390) form = await testForm(p);
        await p.close();
      }
    } finally { await browser.close().catch(() => {}); }
  }
  return qaPacket({ html, files, version: opts.version, hero: opts.hero, heroText, views, form });
}

type Page = import("playwright-core").Page;
async function testForm(p: Page): Promise<FormRun | null> {
  if (!(await p.$("#lead-form"))) return null;
  const leads = () => p.evaluate(() => ((window as unknown as { __leads?: unknown[] }).__leads ?? []).length);
  await p.click("#lead-form button[type=submit]");
  const invalid = await p.locator("#lead-form [aria-invalid=true]").count();
  const summary = await p.isVisible("#lead-errors"), focusOnError = await p.evaluate(() => document.activeElement?.id === "lead-name");
  const emptyBlocked = (await leads()) === 0;
  await p.fill("#lead-name", "Test Sailor");
  await p.fill("#lead-email", "test-sailor@example");
  await p.check("#lead-consent");
  await p.click("#lead-form button[type=submit]");
  const badEmailBlocked = (await leads()) === 0 && (await p.getAttribute("#lead-email", "aria-invalid")) === "true";
  await p.fill("#lead-email", "test.sailor@example.com");
  await p.click("#lead-form button[type=submit]");
  const received = await leads(), status = (await p.textContent("#lead-status")) ?? "";
  return { emptyBlocked, invalid, summary, focusOnError, badEmailBlocked, accepted: received > 0, received, status };
}
