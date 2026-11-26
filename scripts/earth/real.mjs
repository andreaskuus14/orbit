// Estonia real-data stills (feat/earth-estonia-real): before (OSM boxes on the vector ground) and after (Land Board LOD2 buildings
// on the orthophoto) for Tallinn old town, Kalamaja, Tartu centre and Otepää, at ~400 m and ~1.2 km, by day and at dusk.
// node --experimental-strip-types scripts/earth/real.mjs <outDir>   (env: SHOTS=name,filter  MODE=after|before|both)
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
import { tileMesh, emptyMesh } from "../../src/lib/earth-ee3d-store.ts";
import { encodeMesh, ORTHO_URL } from "../../src/lib/earth-ee3d-pure.ts";
import { parseGround } from "../../src/lib/earth-ground-pure.ts";
import { tileBox } from "../../src/lib/earth-buildings-pure.ts";
const out = path.resolve(process.argv[2] ?? "/tmp/earth-real"), tmp = process.env.EARTH_TMP ?? "/tmp/earth-h", cache = process.env.EE_CACHE ?? "/tmp/ee3dcache";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
mkdirSync(out, { recursive: true }); mkdirSync(`${tmp}/tiles`, { recursive: true }); mkdirSync(`${tmp}/osm`, { recursive: true });
if (!existsSync(`${tmp}/data.json`)) execFileSync("node", ["--experimental-strip-types", `${root}/scripts/earth/data.ts`, `${tmp}/data.json`], { stdio: "inherit" });
await build({ entryPoints: [`${root}/scripts/earth/entry-real.ts`], bundle: true, outfile: `${tmp}/bundle-r.js`, format: "iife", tsconfig: `${root}/tsconfig.json`, logLevel: "warning" });
const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, eo: ORTHO_URL };
// "before": the OSM layer's tiles from the OSM API (Overpass is blocked here), four quarter requests per z14 tile, one at a time
let osmChain = Promise.resolve();
async function osmTile(x, y) {
  const f = `${tmp}/osm/b_${x}_${y}.json`; if (existsSync(f)) return readFileSync(f);
  const b = tileBox(x, y), nodes = new Map(), ways = new Map(), rels = new Map();
  for (const [w, s, e, n] of [[b.w, b.s, (b.w + b.e) / 2, (b.s + b.n) / 2], [(b.w + b.e) / 2, b.s, b.e, (b.s + b.n) / 2], [b.w, (b.s + b.n) / 2, (b.w + b.e) / 2, b.n], [(b.w + b.e) / 2, (b.s + b.n) / 2, b.e, b.n]]) {
    await new Promise((r) => setTimeout(r, 1200));
    const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`, { headers: { "User-Agent": "ORBIT stills (dev)" } });
    if (!r.ok) continue;
    for (const el of (await r.json()).elements) (el.type === "node" ? nodes : el.type === "way" ? ways : rels).set(el.id, el);
  }
  const geo = (w) => w.nodes.map((n) => nodes.get(n)).filter(Boolean).map((n) => ({ lat: n.lat, lon: n.lon }));
  const keep = (t = {}) => t.building || t.highway || t.railway || t.natural || t.waterway || t.landuse || t.leisure;
  const els = [];
  for (const w of ways.values()) if (keep(w.tags)) { const g = geo(w); if (g.length === w.nodes.length) els.push({ type: "way", tags: w.tags, geometry: g }); }
  for (const r of rels.values()) if (r.tags?.type === "multipolygon" && keep(r.tags)) els.push({ type: "relation", tags: r.tags, members: r.members.filter((m) => m.type === "way" && ways.has(m.ref)).map((m) => ({ type: "way", role: m.role, geometry: geo(ways.get(m.ref)) })) });
  const body = Buffer.from(JSON.stringify({ x, y, ...parseGround({ elements: els }, x, y) })); writeFileSync(f, body); return body;
}
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), x = +u.searchParams.get("x"), y = +u.searchParams.get("y");
  try {
    if (u.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(`<!doctype html><meta charset=utf-8><body><script src="/bundle-r.js"></script>`); }
    if (u.pathname === "/data.json") return res.end(readFileSync(`${tmp}/data.json`));
    if (u.pathname === "/bundle-r.js") return res.end(readFileSync(`${tmp}/bundle-r.js`));
    if (u.pathname === "/b") { res.setHeader("Content-Type", "application/json"); const p = osmChain.then(() => osmTile(x, y)); osmChain = p.catch(() => {}); return res.end(await p); }
    if (u.pathname === "/ee3d") { const m = await tileMesh(cache, x, y, fetch, true); res.setHeader("Content-Type", "application/octet-stream"); return res.end(Buffer.from(m && m !== "pending" ? encodeMesh(m) : emptyMesh(x, y))); }
    const k = u.pathname === "/eo" ? "eo" : u.searchParams.get("k"), z = +u.searchParams.get("z"), f = `${tmp}/tiles/${k}_${z}_${x}_${y}`;
    if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) throw 0; writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    res.setHeader("Content-Type", k === "day" || k === "eo" ? "image/jpeg" : "image/png"); res.end(readFileSync(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const T = (h, m) => Date.UTC(2026, 5, 20, h, m); // midsummer: day 10:00 UTC (13:00 local), dusk 19:40 UTC (sun about -1°, 22:40 local)
const places = {
  tallinn: { name: "Tallinn old town", lon: 24.7445, lat: 59.4355, heading: 20 },
  kalamaja: { name: "Kalamaja", lon: 24.733, lat: 59.4455, heading: -30 },
  tartu: { name: "Tartu", lon: 26.7215, lat: 58.3790, heading: 10 },
  otepaa: { name: "Otepää", lon: 26.4975, lat: 58.0585, heading: 0 },
};
const views = { "400m": { alt: 0.4, tilt: 58 }, "1.2km": { alt: 1.2, tilt: 52 } };
const suns = { day: T(10, 0), dusk: T(19, 40) };
const only = process.env.SHOTS?.split(","), mode = process.env.MODE ?? "both";
for (const real of mode === "both" ? [true, false] : [mode === "after"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => { if (process.env.DEBUG || (m.type() === "error" && !/404|Failed to load/.test(m.text()))) console.log("page:", m.text().slice(0, 300)); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/${real ? "?ee=1" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.earthReady, null, { timeout: 0 }); await page.evaluate(() => window.earthReady);
  for (const [pn, pl] of Object.entries(places)) for (const [vn, v] of Object.entries(views)) for (const [sn, sun] of Object.entries(suns)) {
    const name = `${real ? "after" : "before"}-${pn}-${vn}-${sn}.jpg`;
    if (only && !only.some((s) => name.includes(s))) continue;
    if (!real && sn === "dusk" && vn === "400m") continue;
    const t0 = Date.now();
    const tick = setInterval(() => console.log("t", ((Date.now() - t0) / 1000).toFixed(0)), 5000); await page.evaluate((p) => window.shot(p), { ...pl, ...v, sun }); clearInterval(tick);
    await page.screenshot({ path: `${out}/${name}`, type: "jpeg", quality: 90 }); console.log(name, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await page.close();
}
await browser.close(); srv.close();
