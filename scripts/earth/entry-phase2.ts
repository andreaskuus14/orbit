// Phase 2 stills page: the same scene as the app, with fixtures instead of the network: OSM buildings for Tallinn's old town
// (tests/fixtures + an optional larger copy) and local news pinned to Latvian towns from made-up fixture headlines.
import { createEarth, EARTH_CSS } from "../../src/components/earth/earth-scene";
import { townNews, type LocalStory } from "../../src/lib/earth-pure";
import { endingsOf, parseGeoNames, toPlaces } from "../../src/lib/earth-region-pure";
import { lat2y, lon2x } from "../../src/lib/earth-pure";
import { BZ, parseOverpass } from "../../src/lib/earth-buildings-pure";
import type { Pose } from "../../src/lib/earth-pure";
const st = document.createElement("style"); st.textContent = EARTH_CSS + "html,body{margin:0;background:#000}.earth-host{--pr:0px!important}"; document.head.appendChild(st);
const host = document.createElement("div"); host.className = "earth-host"; document.body.appendChild(host);
const e = createEarth(host, { tileUrl: (k, z, x, y) => `/tile?k=${k}&z=${z}&x=${x}&y=${y}`, sunMs: Date.parse("2026-11-23T11:30:00Z"), dpr: 1 });
(window as any).earthReady = (async () => {
  const [data, geo, heads, osm] = await Promise.all(["/data.json", "/geo.txt", "/heads.json", "/osm.json"].map((u) => fetch(u).then((r) => (u.endsWith(".txt") ? r.text() : r.json()))));
  const lv = toPlaces(parseGeoNames(geo as string).filter((c) => c.cc === "LV"), "lv");
  const towns = townNews(heads as LocalStory[], lv, 6, endingsOf("lv"));
  e.setData({ ...(data as any), towns: [...towns, ...(data as any).towns] });
  await e.ready;
  // the fixture covers parts of a few z14 tiles: give it to the tile it mostly sits in
  const b = parseOverpass(osm as any);
  await e.putBuildings(Math.floor(lon2x(24.745, BZ)), Math.floor(lat2y(59.437, BZ)), b);
  return true;
})();
(window as any).shot = (p: Pose, name?: string) => { e.setPlaceName(name ?? null); e.frame(p, 5000); e.frame(p, 5034); };
