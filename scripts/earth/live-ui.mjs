// node --experimental-strip-types scripts/earth/live-ui.mjs [outDir] — drives the REAL Intelligence UI (NewsGlobe + EarthView,
// bundled with esbuild like scripts/intel-ui.mjs) in headless Chrome, the way the owner uses it: press the "Tallinn" tab, wait,
// then check that the Estonia close-up really loaded (requests to /api/earth/ee3d and /api/earth/ee-ortho, the close-up HUD
// shows about 1.2 km) and that the frame is neither black nor full of white blocks. Then mouse-wheel zoom down to the 300 m floor
// and back out. By day and at night (05:27 Tallinn time). The APIs are answered from local caches (EARTH_TMP tiles, EE_CACHE
// LOD2) or upstream on a miss; /api/earth/buildings answers 404 on purpose (the laptop case where the OSM ground didn't come).
// Exits 1 on a failed check.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tileMesh, emptyMesh } from "../../src/lib/earth-ee3d-store.ts";
import { encodeMesh, ORTHO_URL } from "../../src/lib/earth-ee3d-pure.ts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const out = path.resolve(process.argv[2] ?? "/tmp/earth-live-ui"), tmp = process.env.EARTH_TMP ?? "/tmp/earth-h", cache = process.env.EE_CACHE ?? "/tmp/ee3dcache";
mkdirSync(out, { recursive: true }); mkdirSync(`${tmp}/tiles`, { recursive: true });
const fails = [], check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(path.join(root, "src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: root })]).process(cssIn, { from: path.join(root, "src/app/globals.css") })).css;
const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import NewsGlobe from "@/components/NewsGlobe";
createRoot(document.getElementById("root")).render(
  <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
    <header className="absolute inset-x-0 top-0 z-30 flex h-14 items-center px-4"><span className="brand">Orbital</span></header>
    <NewsGlobe onClose={() => {}} quality="low" />
    <div className="glass drawer" role="dialog" aria-label="Intelligence"><div className="min-h-0 flex-1 overflow-y-auto"><p style={{ height: 2000 }}>Panel</p></div></div>
    <form className="cmdbar glass flex gap-2"><input className="field w-full" placeholder="Ask ORBIT" /></form>
  </main>);`, loader: "tsx", resolveDir: path.join(root, "src") },
  bundle: true, write: false, outdir: "/tmp/earth-live-ui-out", format: "esm", jsx: "automatic", logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""' },
  loader: { ".json": "json", ".css": "css", ".module.css": "local-css" },
})).outputFiles;
const appJs = js.find((f) => f.path.endsWith(".js")).text, moduleCss = js.find((f) => f.path.endsWith(".css"))?.text ?? "";

const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, eo: ORTHO_URL };
async function tile(k, z, x, y) {
  const f = `${tmp}/tiles/${k}_${z}_${x}_${y}`;
  if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) return null; writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  return readFileSync(f);
}
/** Mean brightness (0-255) and the share of near-white pixels in the free stage (left of the panel, below the bar). */
async function looks(file, vp) {
  const { data, info } = await sharp(file).extract({ left: 0, top: 110, width: Math.round(vp.width * 0.6), height: vp.height - 220 }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0, white = 0; const n = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) { const l = 0.3 * data[i] + 0.55 * data[i + 1] + 0.15 * data[i + 2]; sum += l; if (l > 200) white++; }
  return { mean: sum / n, white: white / n };
}

const ORIGIN = "http://orbit.test", vp = { width: 1440, height: 900 };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
const RUNS = { day: "2026-11-26T12:00:00+02:00", night: "2026-11-26T05:27:00+02:00" };
try {
  for (const [when, at] of Object.entries(RUNS)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 }), page = await ctx.newPage();
    page.setDefaultTimeout(240_000);
    await page.clock.setFixedTime(new Date(at)); // Date.now() only: the sun; timers and frames run normally
    await page.addInitScript(() => { try { localStorage.setItem("orbit.lang", "en"); localStorage.setItem("orbit.intel.map", "earth"); } catch {} });
    page.on("pageerror", (e) => console.log("pageerror", e.message));
    const hits = { ee3d: 0, ortho: 0 };
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const u = new URL(route.request().url()), p = u.pathname, q = (k) => Number(u.searchParams.get(k));
      try {
        if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-motion="on"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
        if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
        if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
        if (p === "/api/earth/tile") { const b = await tile(u.searchParams.get("k"), q("z"), q("x"), q("y")); return b ? route.fulfill({ contentType: u.searchParams.get("k") === "day" ? "image/jpeg" : "image/png", body: b }) : route.fulfill({ status: 502, body: "" }); }
        if (p === "/api/earth/ee-ortho") { hits.ortho++; const b = await tile("eo", q("z"), q("x"), q("y")); return b ? route.fulfill({ contentType: "image/jpeg", body: b }) : route.fulfill({ status: 502, body: "" }); }
        if (p === "/api/earth/ee3d") { hits.ee3d++; const m = await tileMesh(cache, q("x"), q("y"), fetch, true); return route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(m && m !== "pending" ? encodeMesh(m) : emptyMesh(q("x"), q("y"))) }); }
        if (p === "/api/news/geo") return route.fulfill({ json: { hours: 72, total: 0, regions: [], towns: [] } });
      } catch (e) { console.log("route", p, String(e).slice(0, 120)); }
      return route.fulfill({ status: 404, json: { error: "not in harness" } });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector("[data-intel-tab=town]"); await page.waitForTimeout(8000); // swiftshader: first frames are slow
    await page.click("[data-intel-tab=town]");
    const altOf = () => page.evaluate(() => { const h = document.querySelector(".ee-hud"); const v = document.querySelector(".ee-alt-v")?.textContent ?? ""; return { on: Number(getComputedStyle(h ?? document.body).opacity), v }; });
    let a = { on: 0, v: "" };
    for (let i = 0; i < 90 && !(a.on > 0.9 && hits.ee3d > 0); i++) { await page.waitForTimeout(2000); a = await altOf(); }
    await page.waitForTimeout(6000); a = await altOf();
    const f1 = `${out}/live-${when}-tallinn-tab.jpg`; await page.screenshot({ path: f1, type: "jpeg", quality: 88 });
    const l1 = await looks(f1, vp);
    check(hits.ee3d > 0 && hits.ortho > 0, `${when}: Tallinn tab loads the real layer (ee3d ${hits.ee3d}, ee-ortho ${hits.ortho} requests)`);
    check(a.on > 0.9 && /^1\.[0-9]+ km$/.test(a.v), `${when}: close-up HUD on at about 1.2 km (${a.v}, opacity ${a.on.toFixed(2)})`);
    check(l1.mean > (when === "day" ? 35 : 6) && (when === "day" || l1.white < 0.02), `${when}: frame not black, no white blocks at night (mean ${l1.mean.toFixed(1)}, white ${(l1.white * 100).toFixed(2)}%)`);
    // mouse wheel over the planet: in to the floor, then out again
    await page.mouse.move(vp.width * 0.3, vp.height * 0.5);
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(40); }
    await page.waitForTimeout(8000); a = await altOf();
    const f2 = `${out}/live-${when}-wheel-300m.jpg`; await page.screenshot({ path: f2, type: "jpeg", quality: 88 });
    check(a.v === "300 m", `${when}: wheel zooms in to the 300 m floor (${a.v})`);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(40); }
    await page.waitForTimeout(1500); a = await altOf();
    check(/km$/.test(a.v) || a.on < 0.9, `${when}: wheel zooms back out (${a.v})`);
    // 5.9 km over the city (the owner's night report): lit, not white blocks. 
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(30); } // to the 300 m floor, then 21 steps of x1.155 = about 6 km
    for (let i = 0; i < 21; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
    await page.waitForTimeout(9000);
    const f3 = `${out}/live-${when}-6km.jpg`; await page.screenshot({ path: f3, type: "jpeg", quality: 88 });
    const l3 = await looks(f3, vp);
    check((when === "day" || l3.white < 0.02) && l3.mean > (when === "day" ? 25 : 4), `${when}: ~6 km over Tallinn: no white blocks at night (mean ${l3.mean.toFixed(1)}, white ${(l3.white * 100).toFixed(2)}%)`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails.length ? `${fails.length} failed` : "all checks passed");
process.exit(fails.length ? 1 : 0);
