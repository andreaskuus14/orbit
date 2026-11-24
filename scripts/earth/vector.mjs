// Vector-ground stills: Tallinn close-ups with the OSM map under the buildings, through the app's own tile loading (buildingsUrl).
// node scripts/earth/vector.mjs <outDir> <tilesDir>   tilesDir holds b_<x>_<y>.json = { x, y, buildings, ground } (parseGround output;
// made from OSM API downloads with scripts/earth/osmapi-to-overpass.mjs). Missing tiles fall back to the committed fixture tile.
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
const out = path.resolve(process.argv[2] ?? "/tmp/earth-vector"), bdir = process.argv[3], tmp = process.env.EARTH_TMP ?? "/tmp/earth-h";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
mkdirSync(out, { recursive: true }); mkdirSync(tmp, { recursive: true });
if (!existsSync(`${tmp}/data.json`)) execFileSync("node", ["--experimental-strip-types", `${root}/scripts/earth/data.ts`, `${tmp}/data.json`], { stdio: "inherit" });
await build({ entryPoints: [`${root}/scripts/earth/entry-vector.ts`], bundle: true, outfile: `${tmp}/bundle-v.js`, format: "iife", tsconfig: `${root}/tsconfig.json`, logLevel: "warning" });
const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(`<!doctype html><meta charset=utf-8><body><script src="/bundle-v.js"></script>`); }
  if (u.pathname === "/data.json") return res.end(readFileSync(`${tmp}/data.json`));
  if (u.pathname === "/bundle-v.js") return res.end(readFileSync(`${tmp}/bundle-v.js`));
  const x = +u.searchParams.get("x"), y = +u.searchParams.get("y");
  if (u.pathname === "/b") { const f = `${bdir}/b_${x}_${y}.json`; res.setHeader("Content-Type", "application/json"); return res.end(bdir && existsSync(f) ? readFileSync(f) : JSON.stringify({ x, y, buildings: [], offline: true })); }
  const k = u.searchParams.get("k"), z = +u.searchParams.get("z");
  const f = `${tmp}/tiles/${k}_${z}_${x}_${y}`;
  try {
    if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) throw 0; mkdirSync(`${tmp}/tiles`, { recursive: true }); writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    res.setHeader("Content-Type", k === "day" ? "image/jpeg" : "image/png"); res.end(readFileSync(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) console.log("page:", m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.earthReady, null, { timeout: 0 });
await page.evaluate(() => window.earthReady);
const only = process.env.SHOTS?.split(",");
// NIGHT=1: the 1.2 km and 4 km views by day, at dusk (sun -3°) and at night (sun -30°), 23 Nov in Tallinn
const T = (h, m) => Date.UTC(2026, 10, 23, h, m);
const v12 = { lon: 24.7451, lat: 59.4375, alt: 1.2, tilt: 55, heading: 25 }, v4 = { lon: 24.748, lat: 59.436, alt: 4, tilt: 50, heading: -10 };
const night = process.env.NIGHT ? Object.fromEntries(Object.entries({ day: T(10, 30), dusk: T(14, 15), night: T(18, 0) }).flatMap(([w, sun]) => [[`${w}-1.2km.jpg`, { ...v12, sun }], [`${w}-4km.jpg`, { ...v4, sun }]])) : null;
const shots = night ?? {
  "v-tallinn-1.2km.jpg": { lon: 24.7451, lat: 59.4375, alt: 1.2, tilt: 55, heading: 25 },
  "v-tallinn-4km.jpg": { lon: 24.748, lat: 59.436, alt: 4, tilt: 50, heading: -10 },
  "v-tallinn-9km.jpg": { lon: 24.75, lat: 59.435, alt: 9, tilt: 45, heading: 0 },
  "v-tallinn-top.jpg": { lon: 24.745, lat: 59.437, alt: 2.5, tilt: 0, heading: 0 },
};
for (const [name, p] of Object.entries(shots)) { if (only && !only.some((s) => name.includes(s))) continue; await page.evaluate((p) => window.shot(p), p); await page.screenshot({ path: `${out}/${name}`, type: "jpeg", quality: 90 }); console.log(name); }
await browser.close(); srv.close();
