// node --no-warnings --experimental-strip-types scripts/business-ui.mjs — the BUSINESS planet in headless Chrome, used like the owner.
// Bundles the real planet (esbuild) with the app's CSS, serves it on a fake origin through Playwright routes and answers /api/*
// from made-up clients. No server, no sign-in, no network. Nothing is ever sent: a "send" POST fails the run.
// BIZ_TAG=before bundles SimpleOr + BusinessPanel (run on origin/main); anything else bundles BusinessShell. Out: BIZ_OUT.
// Numbers: requests to open the planet and to open the client list, /api/business and /api/markets/deals GETs, requests after one
// stage change, long tasks (> 50 ms). Exits 1 on a failed check (after only).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.BIZ_OUT || "smoke-shots/business-ui"), TAG = process.env.BIZ_TAG || "after", AFTER = !TAG.startsWith("before");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;
const entry = AFTER
  ? `import { BusinessShell } from "@/components/BusinessShell"; import { Toaster } from "@/components/ui"; const P = () => <><BusinessShell onClose={() => { window.__closed = 1; }} /><Toaster dismissLabel="Dismiss" /></>;`
  : `import { SimpleOr } from "@/components/SimpleOr"; import BusinessPanel from "@/components/BusinessPanel"; const P = () => <SimpleOr planet="business" onOpenTask={() => {}}><BusinessPanel /></SimpleOr>;`;
const out = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";\n${entry}
createRoot(document.getElementById("root")).render(<main className="orbit-shell relative h-dvh w-full overflow-hidden" style={{ background: "#05070c" }}><aside className="glass drawer" style={{ position: "absolute", right: 16, top: 16, bottom: 16, width: 460, overflow: "auto" }}><P /></aside></main>);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/business-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: true, splitting: false,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".woff2": "dataurl" },
})).outputFiles;
const appJs = out.filter((f) => f.path.endsWith(".js")).map((f) => f.text)[0], moduleCss = out.find((f) => f.path.endsWith(".css"))?.text ?? "";
console.log(`bundle ${(appJs.length / 1024).toFixed(0)} KB js`);

// ---- made-up clients ----
const T0 = Date.now(), DAY = 86_400_000, iso = (ms) => new Date(ms).toISOString();
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const P = (i, name, kind, stage, extra = {}) => ({ id: id(i), name, kind, contact: `info@${name.toLowerCase().replace(/[^a-z]/g, "")}.ee`, stage, fee: 0, notes: "", draft: "", created_at: iso(T0 - (20 - i) * DAY), updated_at: iso(T0 - (12 - i) * DAY), template: null,
  crm: { verified: true, events: [{ at: iso(T0 - 9 * DAY), kind: "stage", text: stage }] }, touch: null, ...extra });
let prospects = [
  P(1, "Kask Pagariäri", "bakery", "lead", { draft: "Tere! Märkasin, et teil pole veebilehte…" }),
  P(2, "Tartu Puhastus", "cleaning", "lead"),
  P(3, "Salong Lumi", "salon", "contacted", { draft: "Tere! Kirjutasin teile eelmisel nädalal…", touch: { last: iso(T0 - 8 * DAY), replied: false }, updated_at: iso(T0 - 8 * DAY) }),
  P(4, "Remont Pluss", "renovation", "replied", { touch: { last: iso(T0 - 2 * DAY), replied: true } }),
  P(5, "Kohvik Mõnus", "café", "pilot", { fee: 0 }),
  P(6, "Auto Abi", "car repair", "paying", { fee: 120 }),
  P(7, "Lille Pood", "florist", "lost", { crm: { verified: true, lost: { reason: "price" }, events: [] } }),
];
const funnel = () => { const counts = { lead: 0, contacted: 0, replied: 0, pilot: 0, paying: 0, lost: 0 }; let monthly = 0; for (const p of prospects) { counts[p.stage]++; if (p.stage === "paying") monthly += p.fee; } return { counts, monthly, total: prospects.length }; };
const state = () => ({ prospects, funnel: funnel(), canSend: true, nightDrafts: [] });

async function routes(ctx, log) {
  await ctx.route(`http://x.test/**`, (route) => { log.push({ url: "SB", bytes: 2 }); return route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="dark" lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
    if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
    const body = r.method() === "POST" ? r.postDataJSON() ?? {} : null;
    const json = (j, status = 200) => { const s = JSON.stringify(j); log.push({ url: `API ${r.method()} ${p}${u.search}`, bytes: s.length, action: body?.action }); return route.fulfill({ status, contentType: "application/json", body: s }); };
    if (body?.action === "send") { fails.push("a send request was made"); return json({ error: "harness never sends" }, 500); }
    if (p === "/api/business") {
      await new Promise((ok) => setTimeout(ok, globalThis.__slow ?? 40));
      if (globalThis.__fail) return json({ error: "relation prospects does not exist" }, 500);
      if (r.method() === "GET") return json(state());
      if (body.action === "update") { prospects = prospects.map((x) => (x.id === body.id ? { ...x, ...(body.stage && { stage: body.stage }), ...(body.notes !== undefined && { notes: body.notes }), updated_at: iso(Date.now()) } : x)); const { crm, touch, ...row } = prospects.find((x) => x.id === body.id); return json(row); }
      if (body.action === "delete") { prospects = prospects.filter((x) => x.id !== body.id); return json({ ok: true }); }
      return json({ ok: true });
    }
    if (p === "/api/markets/deals") return json({ wishes: [], offers: {}, drafts: {}, history: {}, hunted: {}, lastHunt: null, lastError: null, busy: false, callsLeft: 10 });
    if (p === "/api/business/contracts") return json({ contracts: [] });
    if (p === "/api/needs-you") return json({ items: [] });
    if (p === "/api/business/week") return json({ error: "not in harness" }, 404);
    return json({ error: "not in harness" }, 404);
  });
}

const browser = await chromium.launch();
const count = (log, re) => log.filter((x) => re.test(x.url)).length;
const sum = (log) => ({ requests: log.length, kb: Math.round(log.reduce((s, x) => s + x.bytes, 0) / 102.4) / 10, businessGets: count(log, /^API GET \/api\/business$/), dealsGets: count(log, /^API GET \/api\/markets\/deals/) });
const result = { tag: TAG };
async function open(w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr ?? 1, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage(), log = [], errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebGL|THREE/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  await page.addInitScript((lang) => { try { localStorage.setItem("orbit.lang", lang); } catch {} window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true }); }, o.lang ?? "en");
  await routes(ctx, log);
  return { ctx, page, log, errors };
}
const lt = (page) => page.evaluate(() => ({ n: window.__lt.length, max: Math.round(Math.max(0, ...window.__lt)) }));

for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const { ctx, page, log, errors } = await open(w, h);
  const t0 = Date.now();
  await page.goto(`${ORIGIN}/`);
  await page.getByText("Kask Pagariäri").first().waitFor();
  await page.waitForTimeout(800);
  const firstMs = Date.now() - t0;
  await page.screenshot({ path: `${OUT}/${TAG}-${w}.png` });
  if (w === 1440) {
    result.open = { ...sum(log), firstClientsMs: firstMs, ...(await lt(page)), calls: log.map((x) => x.url) };
    // open the client list
    let n = log.length;
    if (!AFTER) { await page.locator("summary").first().click(); await page.getByRole("button", { name: /All tools/ }).click(); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${TAG}-1440-tools.png` }); await page.getByRole("tab", { name: "Clients" }).or(page.getByRole("button", { name: "Clients", exact: true })).first().click(); }
    else { await page.getByRole("button", { name: "More" }).click(); await page.getByRole("menuitem", { name: "Clients", exact: true }).click(); await page.locator(".pu-sheet").waitFor(); }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${TAG}-1440-clients.png` });
    result.clients = sum(log.slice(n));
    result.totalToClients = sum(log);
    // one stage change
    n = log.length;
    await page.getByRole("combobox", { name: /Tartu Puhastus/ }).first().selectOption("contacted");
    await page.waitForTimeout(800);
    result.afterStageChange = { ...sum(log.slice(n)), calls: log.slice(n).map((x) => x.url) };
    if (AFTER) {
      check(result.open.businessGets === 1, "open: /api/business fetched once");
      check(result.totalToClients.businessGets === 1, "open + client list: still one /api/business");
      check(result.totalToClients.dealsGets <= 1, "client list: /api/markets/deals at most once");
      check(result.afterStageChange.businessGets === 0 && result.afterStageChange.requests === 1, "stage change: one POST, no reload");
      check(!(await page.locator("text=services/lead-followup").count()), "no developer text");
      await page.keyboard.press("Escape"); await page.waitForTimeout(250);
      check(!(await page.locator(".pu-sheet").count()), "Esc closes the client sheet");
      for (const name of ["Find clients", "Money", "What works", "Setup"]) {
        await page.getByRole("button", { name: "More" }).click();
        await page.getByRole("menuitem", { name, exact: true }).click();
        await page.locator(".pu-sheet").waitFor({ timeout: 5000 }).catch(() => console.log("SHEET FAIL", name, errors)); await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/${TAG}-1440-sheet-${name.toLowerCase().replace(/ /g, "-")}.png` });
        if (name === "Setup") check(!(await page.locator("text=services/lead-followup").count()), "Setup: no developer text");
        await page.keyboard.press("Escape"); await page.waitForTimeout(250);
      }
      // keyboard: the pipeline map nodes are buttons
      const dots = page.locator(".biz-map [role=button], .biz-map button");
      check((await dots.count()) >= 6, "map: every client is a keyboard button");
      await dots.first().focus(); await page.keyboard.press("Enter"); await page.locator(".pu-sheet").waitFor({ timeout: 3000 }).catch(() => {});
      check(await page.locator(".pu-sheet").count() > 0, "map: Enter on a client opens it");
      await page.screenshot({ path: `${OUT}/${TAG}-1440-map-open.png` });
      await page.keyboard.press("Escape");
    }
    result.errors = errors;
    if (AFTER) check(!errors.length, `no console errors (${errors.join(" | ")})`);
  }
  if (AFTER) {
    const clip = await page.evaluate(() => { const s = document.querySelector(".pu-shell"), b = s.getBoundingClientRect(); return b.bottom <= innerHeight + 1 && s.scrollWidth <= s.clientWidth + 1; });
    check(clip, `${w}×${h}: shell fits, no sideways scroll`);
  }
  await ctx.close();
}
if (AFTER) {
  globalThis.__slow = 3000;
  { const { ctx, page } = await open(1440, 900); await page.goto(`${ORIGIN}/`); await page.waitForTimeout(600); check(await page.locator(".pu-shell [role=status]").count() > 0, "loading state shows"); await page.screenshot({ path: `${OUT}/${TAG}-1440-loading.png` }); await ctx.close(); }
  globalThis.__slow = 40; globalThis.__fail = true;
  { const { ctx, page } = await open(1440, 900); await page.goto(`${ORIGIN}/`); await page.locator("[role=alert]").first().waitFor(); await page.waitForTimeout(400);
    check(!(await page.locator("text=relation prospects").count()), "error state: plain words, no raw error");
    check((await page.locator("[role=alert]").count()) === 1, "error state: one message, no sub-panel errors under it");
    await page.screenshot({ path: `${OUT}/${TAG}-1440-error.png` }); await ctx.close(); }
  globalThis.__fail = false;
  { const { ctx, page, errors } = await open(1440, 900, { lang: "et" }); await page.goto(`${ORIGIN}/`); await page.getByText("Kask Pagariäri").first().waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${TAG}-1440-et.png` }); check(!errors.length, "Estonian: no errors"); await ctx.close(); }
  { const { ctx, page } = await open(1440, 900, { reduced: true, dpr: 2 }); await page.goto(`${ORIGIN}/`); await page.getByText("Kask Pagariäri").first().waitFor(); await page.waitForTimeout(400); const bb = await page.locator(".pu-shell").boundingBox(); await page.screenshot({ path: `${OUT}/${TAG}-1440-shell-2x.png`, clip: bb }); await ctx.close(); }
}
await browser.close();
writeFileSync(`${OUT}/${TAG}-numbers.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, open: { ...result.open, calls: result.open?.calls.length } }, null, 1));
if (AFTER && fails.length) { console.log(`${fails.length} failed`); process.exit(1); }
