// Headless motion test for the Planet Earth view: orbit → Estonia → Tallinn, 30 fps, real tiles and live feeds.
// node scripts/earth/motion.mjs <outDir>   (needs Chrome; tiles cached in /tmp/earth-h/tiles)
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
const out = path.resolve(process.argv[2] ?? "/tmp/earth-out"), W = 1280, H = 720, FPS = 30, tmp = process.env.EARTH_TMP ?? "/tmp/earth-h";
mkdirSync(`${tmp}/frames`, { recursive: true }); mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
await build({ entryPoints: [`${root}/scripts/earth/entry.ts`], bundle: true, outfile: `${tmp}/bundle.js`, format: "iife", tsconfig: `${root}/tsconfig.json`, logLevel: "warning" });
if (!existsSync(`${tmp}/data.json`)) execFileSync("node", ["--experimental-strip-types", `${root}/scripts/earth/data.ts`, `${tmp}/data.json`], { stdio: "inherit" });
const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(`<!doctype html><meta charset=utf-8><body><script src="/bundle.js"></script>`); }
  if (u.pathname === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(readFileSync(`${tmp}/bundle.js`)); }
  if (u.pathname === "/data.json") { res.setHeader("Content-Type", "application/json"); return res.end(readFileSync(`${tmp}/data.json`)); }
  const k = u.searchParams.get("k"), z = +u.searchParams.get("z"), x = +u.searchParams.get("x"), y = +u.searchParams.get("y");
  const f = `${tmp}/tiles/${k}_${z}_${x}_${y}`;
  try {
    if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) throw 0; mkdirSync(`${tmp}/tiles`, { recursive: true }); writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    res.setHeader("Content-Type", k === "day" ? "image/jpeg" : "image/png"); res.end(readFileSync(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const port = srv.address().port;
let browser, page;
// software WebGL leaks over a long run, so the page is reopened every 90 frames (and after a crash); frames on disk are kept
async function open() {
  try { await browser?.close(); } catch { /* gone */ }
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) console.log("page:", m.text().slice(0, 400)); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(() => window.earthReady);
}
await open();
const len = await page.evaluate(() => window.pathLen), n = Math.round((len / 1000) * FPS);
if (process.env.FRESH) { rmSync(`${tmp}/frames`, { recursive: true, force: true }); mkdirSync(`${tmp}/frames`); }
const stills = { "still-orbit.jpg": 1200, "still-country.jpg": 4300, "still-dive.jpg": 5600, "still-region.jpg": 8400, "still-tallinn.jpg": len - 200 };
for (let i = 0, since = 0; i <= (process.env.STILLS ? -1 : n); i++) {
  const ms = (i / FPS) * 1000, file = `${tmp}/frames/f${String(i).padStart(4, "0")}.jpg`;
  if (existsSync(file)) continue;
  try {
    if (since++ >= 90) { await open(); since = 0; }
    await page.evaluate((t) => { window.renderAt(t - 34); window.renderAt(t); }, ms); // the frame before primes label placement
    await page.screenshot({ path: file, type: "jpeg", quality: 90 });
  } catch (e) { console.log("reopening after", String(e).slice(0, 80)); await open(); since = 0; i--; continue; }
  if (i % 60 === 0) console.log(`frame ${i}/${n}`);
}
for (const [name, ms] of Object.entries(stills)) { await page.evaluate((t) => { window.renderAt(t); window.renderAt(t); }, ms); await page.screenshot({ path: `${out}/${name}`, type: "jpeg", quality: 92 }); }
await browser.close(); srv.close();
if (!process.env.STILLS) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${tmp}/frames/f%04d.jpg`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", `${out}/earth-motion.mp4`]);
console.log(`wrote ${out}/earth-motion.mp4 (${(len / 1000).toFixed(1)} s) and stills`);
