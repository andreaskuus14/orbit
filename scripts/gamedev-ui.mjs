// node --no-warnings --experimental-strip-types scripts/gamedev-ui.mjs — the GAME DEV planet in headless Chrome, used like the owner.
// Bundles the real DevWorld (esbuild, code splitting on, so lazy tools are separate chunks) and the app's CSS, serves them on a fake
// origin and answers /api/* from test data (the seed world, a running and a failed QA playtest, one Needs-you item, two built sites).
// Every write is answered locally. Run from the worktree to measure (cwd = repo root). GD_TAG names files (before / after).
// Numbers: JS bytes on first load, idle fps + long tasks, requests made on load, DOM nodes.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(resolve("package.json"));
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.GD_OUT || "smoke-shots/gamedev-ui"), TAG = process.env.GD_TAG || "after", AFTER = !TAG.startsWith("before");
const FLAT = process.env.GD_FLAT === "1";
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;
const files = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import DevWorld from "@/components/DevWorld";
function App() {
  return <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
    <div className="kept absolute inset-0"><DevWorld flat={${FLAT}} reduced={!!window.__reduced} quality="auto" onClose={() => { window.__closed = (window.__closed || 0) + 1; }} onOpenTask={(id) => { window.__task = id; }} /></div>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, splitting: true, outdir: "/tmp/gamedev-ui-out", entryNames: "app", chunkNames: "c/[name]-[hash]", format: "esm", jsx: "automatic", logLevel: "error", minify: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".webp": "dataurl" },
})).outputFiles;
const served = new Map(files.map((f) => [f.path.replace("/tmp/gamedev-ui-out", ""), f.text]));
const moduleCss = files.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
const allJs = files.filter((f) => f.path.endsWith(".js")).reduce((s, f) => s + f.contents.length, 0);
console.log(`bundle: ${files.filter((f) => f.path.endsWith(".js")).length} js files, ${(allJs / 1024).toFixed(0)} KB total`);

const { SEED_WORLD } = await import(resolve("src/lib/devworld-pure.ts"));
const NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const seedWorld = structuredClone(SEED_WORLD);
const tasks = [
  { id: "t-run", parent_id: null, agent: "qa", title: `Playtest plan: "${seedWorld.games[0].name}"`, status: "running", created_at: iso(NOW - 120_000), started_at: iso(NOW - 110_000), finished_at: null },
  { id: "t-fail", parent_id: null, agent: "qa", title: `Playtest plan: "${seedWorld.games.at(-1).name}"`, status: "failed", created_at: iso(NOW - 7_200_000), started_at: iso(NOW - 7_100_000), finished_at: iso(NOW - 7_000_000) },
  { id: "t-other", parent_id: null, agent: "forge", title: "Write a newsletter", status: "running", created_at: iso(NOW - 60_000), started_at: iso(NOW - 50_000), finished_at: null },
];
const needs = { items: [{ ref: "approval:luau", planet: "creation", kind: "decide", cause: "approval", title: "A script change waits for your OK", detail: "Coin pickup fix", at: iso(NOW - 600_000), act: { open: { panel: "creation" } } }] };
const html = `<!doctype html><html data-motion="on" class="dark" lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

async function routes(ctx, log, opts = {}) {
  let world = structuredClone(seedWorld), updatedAt = iso(NOW);
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname, m = r.method();
    if (p === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
    if (served.has(p)) { log.js.push([p, Buffer.byteLength(served.get(p))]); return route.fulfill({ contentType: "text/javascript", body: served.get(p) }); }
    log.api.push(`${m} ${p}${u.search}`);
    if (opts.broken && p === "/api/devworld") return route.fulfill({ status: 502, json: { error: "fetch failed: ECONNREFUSED 127.0.0.1:54321" } });
    if (p === "/api/devworld" && m === "GET") return route.fulfill({ json: { world, updatedAt, seeded: true } });
    if (p === "/api/devworld" && m === "PUT") { const b = JSON.parse(r.postData() || "{}"); world = b.world; updatedAt = iso(Date.now()); return route.fulfill({ json: { world, updatedAt } }); }
    if (p === "/api/devworld/local") return route.fulfill({ json: { state: "off", text: "" } });
    if (p === "/api/workspace") return route.fulfill({ json: { workspaces: [{ slug: "pet-sim-landing", mtime: NOW - 86_400_000, preview: "/ws/pet-sim-landing" }, { slug: "forge-site", mtime: NOW - 3 * 86_400_000, preview: "/ws/forge-site" }] } });
    if (p === "/api/needs-you") return route.fulfill({ json: needs });
    if (p === "/api/tasks" && m === "GET") return route.fulfill({ json: { tasks } });
    if (p === "/api/tasks" && m === "POST") return route.fulfill({ json: { task: { id: "task-new" } } });
    if (p === "/api/refs") return route.fulfill({ json: { board: [], style: { items: [], keywords: [], summary: "", updatedAt: "" } } });
    return route.fulfill({ status: 404, json: { error: "not in harness" } });
  });
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const perf = { tag: TAG, flat: FLAT, sizes: {} };
const shoot = (page, name) => page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
try {
  for (const [w, h] of [[1440, 900], [1280, 720]]) {
    const P = {}, log = { js: [], api: [] }, errors = [], dialogs = [];
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => {
      try { localStorage.setItem("orbit.lang", "en"); localStorage.setItem("orbit.manual.creation", "0"); } catch {}
      window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true });
    });
    await routes(ctx, log);
    const t0 = Date.now();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction((n) => document.body.innerText.includes(n), seedWorld.games[0].name, { timeout: 60_000 }).catch(() => {});
    P.firstDataMs = Date.now() - t0;
    await page.waitForTimeout(FLAT ? 1500 : 6000);
    P.loadJsKB = Math.round(log.js.reduce((s, [, b]) => s + b, 0) / 1024); P.loadJsFiles = log.js.length;
    P.loadApi = [...new Set(log.api)];
    P.loadLongTasks = await page.evaluate(() => ({ n: window.__lt.length, longestMs: Math.round(Math.max(0, ...window.__lt)), totalMs: Math.round(window.__lt.reduce((a, b) => a + b, 0)) }));
    await shoot(page, `${w}-home`);
    P.idle = await page.evaluate(async () => {
      window.__lt.length = 0; let n = 0; const s = performance.now();
      await new Promise((ok) => { const f = () => { n++; if (performance.now() - s < 5000) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
      return { fps: Math.round((n / ((performance.now() - s) / 1000)) * 10) / 10, longTasks: window.__lt.length, longestMs: Math.round(Math.max(0, ...window.__lt)), domNodes: document.querySelectorAll("*").length };
    });
    const text = await page.locator("body").innerText();
    P.emojiOnScreen = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
    P.spacedCaps = await page.evaluate(() => [...document.querySelectorAll(".gamedev *")].filter((e) => { const s = getComputedStyle(e); return s.textTransform === "uppercase" && parseFloat(s.letterSpacing) > 1 && e.textContent.trim() && e.getBoundingClientRect().width > 0; }).length);
    P.refsFetchedOnLoad = log.api.some((a) => a.includes("/api/refs"));
    check(!/undefined|\bNaN\b|Invalid Date/.test(text), `${TAG}-${w}: no undefined/NaN on screen`);
    if (AFTER) {
      check(!P.refsFetchedOnLoad, `${w}: RefBoard does not fetch before it is opened`);
      check(P.emojiOnScreen === 0, `${w}: no emoji on the first screen`);
      check(/Needs you/.test(text) && /Working on it/.test(text) && /Your games/.test(text), `${w}: Needs you → Working on it → Your games`);
      const fit = await page.evaluate(() => { const s = document.querySelector(".gd-shell")?.getBoundingClientRect(); return s ? { bottom: Math.round(s.bottom), h: innerHeight } : null; });
      check(!!fit && fit.bottom <= fit.h, `${w}: the shell fits the window ${JSON.stringify(fit)}`);
      // All tools → References: the RefBoard chunk and /api/refs load only now
      await page.getByRole("button", { name: "More", exact: true }).click(); await page.getByRole("menuitem", { name: "All tools" }).click();
      await page.locator(".pu-sheet").waitFor({ timeout: 15_000 }); await page.waitForTimeout(500); await shoot(page, `${w}-tools`);
      const js0 = log.js.length, s = Date.now();
      await page.locator(".pu-sheet").getByRole("button", { name: /^References/ }).click();
      await page.waitForTimeout(400);
      if (await page.getByRole("combobox", { name: "Active game" }).count()) await page.getByRole("combobox", { name: "Active game" }).selectOption({ index: 1 });
      await page.waitForFunction(() => !document.querySelector(".gd-tool [role=status][aria-label='Opening the tool']"), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(800); P.openRefsMs = Date.now() - s; P.refsChunks = log.js.length - js0;
      check(log.api.some((a) => a.includes("/api/refs")), `${w}: References fetches /api/refs when opened`);
      await shoot(page, `${w}-refs`);
      await page.getByRole("button", { name: "Back to Game dev" }).click(); await page.waitForTimeout(300);
      if (await page.getByRole("button", { name: "Back to Game dev" }).count()) await page.getByRole("button", { name: "Back to Game dev" }).click();
      // a game → delete → Undo (no browser dialog)
      await page.locator(".pu-row", { hasText: seedWorld.games[0].name }).first().click(); await page.waitForTimeout(600);
      await shoot(page, `${w}-game`);
      await page.getByRole("button", { name: "Delete game" }).click(); await page.waitForTimeout(400);
      await shoot(page, `${w}-deleted`);
      check(dialogs.length === 0, `${w}: delete asks no browser confirm()`);
      await page.locator(".pu-toast").getByRole("button", { name: "Undo" }).click(); await page.waitForTimeout(800);
      check((await page.locator("body").innerText()).includes(seedWorld.games[0].name), `${w}: Undo brings the game back`);
      // ask goes to CORE
      await page.evaluate(() => { window.__asked = null; addEventListener("orbit:voice-ask", (e) => { window.__asked = e.detail?.text; }); });
      const ask = page.getByRole("textbox", { name: "Ask Game dev" }); await ask.fill("Check my pet simulator for bugs"); await ask.press("Enter"); await page.waitForTimeout(300);
      check(await page.evaluate(() => window.__asked) === "Check my pet simulator for bugs", `${w}: the ask goes to CORE`);
    } else {
      await page.locator("details summary").first().click().catch(() => {}); await page.waitForTimeout(300);
      const more = page.getByRole("button", { name: /All tools|Manual/i }).first();
      if (await more.count()) { await more.click().catch(() => {}); await page.waitForTimeout(1500); await shoot(page, `${w}-tools`); }
      P.refsFetchedAfterManual = log.api.some((a) => a.includes("/api/refs")); P.apiAfterManual = [...new Set(log.api)];
    }
    check(!errors.length, `${TAG}-${w}: no page errors${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    perf.sizes[w] = P; await ctx.close();
  }
  if (AFTER) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage(), log = { js: [], api: [] };
    await page.addInitScript(() => { try { localStorage.setItem("orbit.lang", "en"); } catch {} });
    await routes(ctx, log, { broken: true }); await page.goto(`${ORIGIN}/`); await page.waitForTimeout(FLAT ? 2000 : 5000);
    const t = await page.locator("body").innerText();
    check(/Couldn.t load your games/.test(t) && !/ECONNREFUSED|54321/.test(t), "broken API: plain words, no raw error");
    await shoot(page, "1440-broken"); await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/${TAG}-perf.json`, JSON.stringify(perf, null, 2));
console.log(JSON.stringify(perf, null, 2));
if (fails.length) { console.log(`${fails.length} check(s) failed`); if (AFTER) process.exitCode = 1; }
