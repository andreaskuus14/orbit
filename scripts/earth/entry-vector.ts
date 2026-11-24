// Vector-ground stills page: the app's scene, tiles (buildings + ground) from the stills server instead of /api/earth/buildings.
import { createEarth, EARTH_CSS } from "../../src/components/earth/earth-scene";
import type { Pose } from "../../src/lib/earth-pure";
const st = document.createElement("style"); st.textContent = EARTH_CSS + "html,body{margin:0;background:#000}.earth-host{--pr:0px!important}"; document.head.appendChild(st);
const host = document.createElement("div"); host.className = "earth-host"; document.body.appendChild(host);
const e = createEarth(host, { tileUrl: (k, z, x, y) => `/tile?k=${k}&z=${z}&x=${x}&y=${y}`, buildingsUrl: (x, y) => `/b?x=${x}&y=${y}`, sunMs: Date.parse("2026-11-23T11:30:00Z"), dpr: 1 });
(window as any).earthReady = (async () => { e.setData(await fetch("/data.json").then((r) => r.json())); await e.ready; return true; })();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// frame until every tile around the pose has loaded (the scene throttles tile requests to every 400 ms, two at a time)
(window as any).shot = async (p: Pose) => { e.setPlaceName("Tallinn"); for (let i = 0; i < 200; i++) { e.frame(p, 5000); await wait(450); if (i > 3 && !e.loading()) break; } e.frame(p, 5000); e.frame(p, 5034); };
