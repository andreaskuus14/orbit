// Earth frame-time + stills bench: node scripts/earth/bench.mjs <outDir> [tag]   (Chrome + SwiftShader; tiles cached in /tmp/earth-h/tiles)
// Software GL: the numbers compare before/after on this box, they are not the laptop's fps. Sizes: EARTH_SIZES (1440x900,1920x1080).
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
const out = path.resolve(process.argv[2] ?? "/tmp/earth-bench"), tag = process.argv[3] ?? "after", tmp = process.env.EARTH_TMP ?? "/tmp/earth-h";
mkdirSync(out, { recursive: true }); mkdirSync(`${tmp}/tiles`, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
await build({ entryPoints: [`${root}/scripts/earth/entry-bench.ts`], bundle: true, outfile: `${tmp}/bench.js`, format: "iife", tsconfig: `${root}/tsconfig.json`, logLevel: "warning" });
if (!existsSync(`${tmp}/data.json`)) execFileSync("node", ["--experimental-strip-types", `${root}/scripts/earth/data.ts`, `${tmp}/data.json`], { stdio: "inherit" });
const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` };
let tiles = 0;
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(`<!doctype html><meta charset=utf-8><body><script src="/bench.js"></script>`); }
  if (u.pathname === "/bench.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(readFileSync(`${tmp}/bench.js`)); }
  if (u.pathname === "/data.json") { res.setHeader("Content-Type", "application/json"); return res.end(readFileSync(`${tmp}/data.json`)); }
  if (u.pathname !== "/tile") { res.statusCode = 404; return res.end(); }
  const k = u.searchParams.get("k"), z = +u.searchParams.get("z"), x = +u.searchParams.get("x"), y = +u.searchParams.get("y"), f = `${tmp}/tiles/${k}_${z}_${x}_${y}`;
  tiles++;
  try {
    if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) throw 0; writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    res.setHeader("Content-Type", k === "day" ? "image/jpeg" : "image/png"); res.end(readFileSync(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const port = srv.address().port;
const SHOTS = { orbit: { lon: 22, lat: 40, alt: 10500, tilt: 0, heading: 0 }, alps: { lon: 10.5, lat: 46.6, alt: 420, tilt: 35, heading: 0 },
  country: { lon: 25.0, lat: 58.4, alt: 900, tilt: 28, heading: 0 }, norway: { lon: 7.0, lat: 61.2, alt: 90, tilt: 45, heading: 20 }, town: { lon: 24.75, lat: 59.425, alt: 22, tilt: 55, heading: 20 } };
const sizes = (process.env.EARTH_SIZES || "1440x900,1920x1080").split(",").map((s) => s.split("x").map(Number));
const res = {};
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const only = process.env.EARTH_SHOTS?.split(",");
  for (const [W, H] of sizes) for (const [name, p] of Object.entries(SHOTS)) for (let attempt = 1; attempt <= 3; attempt++) { // a fresh page per shot; software GL may crash under memory pressure: retry
    if (only && !only.includes(name)) break;
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    try {
      page.on("pageerror", (e) => console.log("page:", e.message));
      await page.goto(`http://127.0.0.1:${port}/`); await page.evaluate(() => window.earthReady);
      tiles = 0;
      const r = await page.evaluate(([p]) => window.bench(p, 12000, 10), [p]);
      await page.screenshot({ path: `${out}/${tag}-${name}-${W}.png` });
      res[`${name}-${W}`] = { ...r, tiles }; console.log(`${tag} ${name} ${W}x${H}: median ${r.median.toFixed(1)} ms, p90 ${r.p90.toFixed(1)} ms, tiles asked ${tiles}`);
      await page.close();
      break;
    } catch (e) { console.log(`${tag} ${name} ${W}x${H}: attempt ${attempt} failed (${e.message.split("\n")[0]})`); await page.close().catch(() => {}); }
  }
} finally { await browser.close(); srv.close(); writeFileSync(`${out}/${tag}-bench.json`, JSON.stringify(res, null, 1)); }
