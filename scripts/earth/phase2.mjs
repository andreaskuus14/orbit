// Phase 2 stills from fixtures: OSM buildings over Tallinn and local news pinned to Latvian towns.
// node scripts/earth/phase2.mjs <outDir> [osm.json]   (needs Chrome; tiles cached in $EARTH_TMP/tiles; data.json from motion.mjs)
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const out = path.resolve(process.argv[2] ?? "/tmp/earth-p2"), tmp = process.env.EARTH_TMP ?? "/tmp/earth-h";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const osm = process.argv[3] ?? `${root}/tests/fixtures/earth-overpass-tallinn.json`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${root}/scripts/earth/entry-phase2.ts`], bundle: true, outfile: `${tmp}/bundle2.js`, format: "iife", tsconfig: `${root}/tsconfig.json`, logLevel: "warning" });
const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` };
const files = { "/data.json": `${tmp}/data.json`, "/geo.txt": `${root}/tests/fixtures/earth-geonames-sample.txt`, "/heads.json": `${root}/tests/fixtures/earth-region-lv.json`, "/osm.json": osm, "/bundle2.js": `${tmp}/bundle2.js` };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(`<!doctype html><meta charset=utf-8><body><script src="/bundle2.js"></script>`); }
  if (files[u.pathname]) return res.end(readFileSync(files[u.pathname]));
  const k = u.searchParams.get("k"), z = +u.searchParams.get("z"), x = +u.searchParams.get("x"), y = +u.searchParams.get("y");
  const f = `${tmp}/tiles/${k}_${z}_${x}_${y}`;
  try {
    if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) throw 0; mkdirSync(`${tmp}/tiles`, { recursive: true }); writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    res.setHeader("Content-Type", k === "day" ? "image/jpeg" : "image/png"); res.end(readFileSync(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) console.log("page:", m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.evaluate(() => window.earthReady);
const shots = {
  "p2-tallinn-buildings.jpg": [{ lon: 24.745, lat: 59.4372, alt: 2.2, tilt: 58, heading: 25 }, null],
  "p2-tallinn-buildings-high.jpg": [{ lon: 24.746, lat: 59.436, alt: 6, tilt: 45, heading: -10 }, null],
  "p2-latvia-region.jpg": [{ lon: 24.3, lat: 56.95, alt: 260, tilt: 40, heading: 0 }, "Latvia, local news"],
};
for (const [name, [p, label]] of Object.entries(shots)) { await page.evaluate(([p, l]) => window.shot(p, l), [p, label]); await page.screenshot({ path: `${out}/${name}`, type: "jpeg", quality: 90 }); }
await browser.close(); srv.close();
console.log(`wrote ${Object.keys(shots).length} stills to ${out}`);
