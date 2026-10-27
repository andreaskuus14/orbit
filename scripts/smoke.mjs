// npm run smoke — browser smoke test of every page reachable without signing in (/demo galaxy + its worlds, /remote and /screen
// pairing screens, /login), at desktop 1440×900 and phone 390×844, reduced motion on. Needs a running server (`npm start`,
// or SMOKE_BASE=<url>) and the preinstalled Playwright + Chromium. Read-only: it never pairs, posts or signs in.
// Prints every finding and exits 1 if there are any. Screenshots go to SMOKE_OUT (default ./smoke-shots).
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

// A globally installed `playwright` (found through NODE_PATH, which only require() honours) ships its matching browsers;
// otherwise the repo's playwright-core (run `npx playwright-core install chromium` once).
const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();

const BASE = (process.env.SMOKE_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = resolve(process.env.SMOKE_OUT || "smoke-shots");
const ORIGIN = new URL(BASE).origin;
const VIEWPORTS = [{ name: "desktop", width: 1440, height: 900, mobile: false }, { name: "mobile", width: 390, height: 844, mobile: true }];
const WORLDS = ["STUDIO", "INTELLIGENCE", "MEMORY", "ARCH"];
// Expected 4xx/503: an unpaired device asking /api/remote* (401), or a PC with the remote switched off (503), is how the page
// learns to show the pairing form or the "remote is off" note.
const EXPECTED = [/^\/api\/remote(\/screen)?$/];
mkdirSync(OUT, { recursive: true });

const DEMO_NOTE = "This is a demo — the real ORBIT runs privately.";
const findings = [], notes = [];
const shots = [];
const add = (where, kind, detail) => findings.push({ where, kind, detail: String(detail).slice(0, 300) });

/** Elements wider than the viewport / poking past its edges, and (phone) visible buttons under 40px. Runs in the page. */
function layoutChecks(mobile) {
  const vw = document.documentElement.clientWidth, out = [];
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute("aria-label")}"]` : ""} "${(el.textContent || "").trim().slice(0, 40)}"`;
  const visible = (el, r) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[aria-hidden=true]");
  if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: "page-scrolls-sideways", detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` });
  for (const el of document.body.querySelectorAll("*")) {
    if (el instanceof SVGElement && el.tagName !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || el.tagName === "CANVAS") continue;
    // Inside a horizontal scroller = reachable by scrolling (carousels, chip rows). Fully off-screen = an intentional off-canvas drawer.
    // Partly off-screen = cut off for the user, which is what we report.
    let scroller = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { scroller = true; break; }
    if (!scroller && r.left < vw && r.right > 0 && (r.right > vw + 1 || r.left < -1) && r.width < vw * 3) out.push({ kind: "overflows-viewport", detail: `${name(el)} x=${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})` });
  }
  if (mobile) for (const el of document.querySelectorAll("button, [role=button], a[href]")) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.height < 40 || r.width < 40) out.push({ kind: "small-tap-target", detail: `${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}` });
  }
  // Collapse duplicates (a whole subtree overflowing reports every child).
  return out.filter((f, i) => out.findIndex((g) => g.kind === f.kind && g.detail === f.detail) === i).slice(0, 40);
}

async function settle(page, ms = 1500) { await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms); }

async function check(page, vp, label) {
  const where = `${vp.name} ${label}`;
  if (await page.getByText(/Application error|Unhandled Runtime Error|client-side exception/i).count()) add(where, "error-boundary", "Next error screen shown");
  // The demo's fetch guard answers refused calls with the demo note as the error on purpose; any other error text is a finding.
  for (const t of await page.locator("p.error:visible, [role=alert]:visible").allTextContents()) if (t.trim() && !t.includes(DEMO_NOTE)) add(where, "visible-error", t.trim());
  for (const f of await page.evaluate(layoutChecks, vp.mobile)) add(where, f.kind, f.detail);
  const file = join(OUT, `${vp.name}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
  await page.screenshot({ path: file }); shots.push(file);
}

async function openPage(browser, vp, path) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const where = () => `${vp.name} ${path}`;
  page.on("pageerror", (e) => add(where(), "uncaught-error", e.message));
  // "Failed to load resource" repeats a response the bad-response check already judged (with its URL).
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) add(where(), "console-error", m.text()); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(ORIGIN) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) add(where(), "request-failed", `${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === ORIGIN && r.status() >= 400 && !((r.status() < 500 || r.status() === 503) && EXPECTED.some((re) => re.test(u.pathname)))) add(where(), "bad-response", `${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!res || res.status() >= 400) add(where(), "bad-response", `${res?.status()} page ${path}`);
  return { ctx, page };
}

async function demo(browser, vp) {
  const { ctx, page } = await openPage(browser, vp, "/demo");
  await settle(page, 4000);
  await check(page, vp, "demo-galaxy");
  // Ctrl+K: the palette lives in the signed-in shell; on /demo it must at least not throw.
  await page.keyboard.press("Control+k"); await page.waitForTimeout(500);
  if (await page.getByRole("dialog").count()) await check(page, vp, "demo-ctrl-k"); else await page.keyboard.press("Escape");
  const nav = page.getByRole("navigation", { name: "Demo tour" });
  await nav.getByRole("button", { name: "CORE" }).click();
  const core = page.getByRole("region", { name: /CORE/ });
  await core.getByRole("button", { name: "What is ORBIT?" }).click();
  await page.waitForTimeout(300);
  await check(page, vp, "demo-core");
  await core.getByRole("button", { name: "Close" }).click();
  for (const w of WORLDS) {
    await nav.getByRole("button", { name: w, exact: true }).click();
    await settle(page, 3000);
    await page.locator(".globe-in:visible").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => add(`${vp.name} world-${w}`, "world-hidden", "world layer still hidden after 23 s"));
    await check(page, vp, `world-${w}`);
    // Every mode/tab toggle inside the world (aria-pressed), on then off. Walk-through is skipped: it grabs the pointer.
    // Labels first: clicking one re-renders the rest, so each is looked up fresh.
    const labels = await page.evaluate(() => [...document.querySelectorAll("[aria-pressed]")]
      .filter((el) => el.checkVisibility() && !el.disabled && !el.closest('nav[aria-label="Demo tour"]') && !el.closest("ol, ul") && !/Walk/.test(el.textContent))
      .map((el) => (el.textContent || "").trim()).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 14));
    for (const text of labels) {
      const t = page.locator("[aria-pressed]:visible").filter({ hasText: text }).first();
      const label = text.replace(/[^\w ]/g, "").trim().slice(0, 20);
      // Playwright's hit test misreads CSS `zoom` (the worlds' panels use 0.9), so on a timeout ask the page what a finger would hit.
      if (!(await t.click({ timeout: 3000 }).then(() => true, () => false))) {
        const hit = await t.evaluate((el) => { const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !top || el.contains(top) ? "" : top.outerHTML.slice(0, 120); }).catch(() => "detached");
        if (hit === "detached") continue; // an earlier toggle switched views and this control left with it
        if (hit) { add(`${vp.name} world-${w}`, "unclickable", `"${text}" is covered by ${hit}`); continue; }
        await t.click({ force: true, timeout: 3000 }).catch(() => {});
      }
      await page.waitForTimeout(800);
      await check(page, vp, `world-${w}-${label}`);
      await t.click({ force: true, timeout: 3000 }).catch(() => {});
    }
    await nav.getByRole("button", { name: "← Galaxy" }).click();
    await page.waitForTimeout(800);
  }
  const blocked = await page.evaluate(() => window.__orbitDemoBlocked ?? []);
  // Not a failure: refused calls are how the demo stays private. Listed so new features that need a fixture are visible.
  if (blocked.length) notes.push(`${vp.name} /demo refused (no fixture): ${[...new Set(blocked)].join(", ")}`);
  await ctx.close();
}

async function plain(browser, vp, path, label) {
  const { ctx, page } = await openPage(browser, vp, path);
  await settle(page);
  await check(page, vp, label);
  await ctx.close();
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const vp of VIEWPORTS) {
    await plain(browser, vp, "/remote", "remote-pair");
    await plain(browser, vp, "/screen", "screen-pair");
    await plain(browser, vp, "/login", "login");
    await demo(browser, vp).catch((e) => add(`${vp.name} /demo`, "smoke-step-failed", e.message));
  }
} finally { await browser.close(); }

for (const n of notes) console.log(`[note] ${n}`);
for (const f of findings) console.log(`[${f.kind}] ${f.where}: ${f.detail}`);
console.log(`\nsmoke: ${findings.length} finding(s), ${shots.length} screenshot(s) in ${OUT}`);
process.exit(findings.length ? 1 : 0);
