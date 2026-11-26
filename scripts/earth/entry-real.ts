// Estonia real-data stills page: the app's scene with the Land Board layer (EE=1 in the URL) or without it (the OSM "before").
import { createEarth, EARTH_CSS } from "../../src/components/earth/earth-scene";
import type { Pose } from "../../src/lib/earth-pure";
const st = document.createElement("style"); st.textContent = EARTH_CSS + "html,body{margin:0;background:#000}.earth-host{--pr:0px!important}"; document.head.appendChild(st);
const host = document.createElement("div"); host.className = "earth-host"; document.body.appendChild(host);
// the app's frame (NewsGlobe): top bar, right panel and the free stage (.intel-stage) the HUD and labels must stay inside
const frame = document.createElement("div"); frame.innerHTML = `<div class="st-bar"></div><div class="st-panel"></div><div class="intel-stage"></div>`; document.body.appendChild(frame);
const fst = document.createElement("style"); fst.textContent = `.st-bar{position:fixed;left:0;right:0;top:0;height:48px;background:rgba(4,10,18,.82);border-bottom:1px solid rgba(120,220,255,.25);z-index:20}
.st-panel{position:fixed;right:0;top:48px;bottom:0;width:300px;background:rgba(4,10,18,.82);border-left:1px solid rgba(120,220,255,.25);z-index:20}
.intel-stage{position:fixed;left:0;top:48px;right:300px;bottom:36px;pointer-events:none;outline:1px dashed rgba(255,255,255,0)}`; document.head.appendChild(fst);
const real = new URLSearchParams(location.search).has("ee");
const e = createEarth(host, { tileUrl: (k, z, x, y) => `/tile?k=${k}&z=${z}&x=${x}&y=${y}`, buildingsUrl: (x, y) => `/b?x=${x}&y=${y}`, sunMs: Date.parse("2026-06-20T10:00:00Z"), dpr: 1,
  ...(real ? { eeMeshUrl: (x: number, y: number) => `/ee3d?x=${x}&y=${y}`, eeOrthoUrl: (z: number, x: number, y: number) => `/eo?z=${z}&x=${x}&y=${y}`, eeMaxTiles: 12, eePlacesUrl: (x: number, y: number) => `/eep?x=${x}&y=${y}` } : {}),
  rightInset: () => 300, topLimit: () => 48, zones: () => [[0, 0, 1280, 56], [972, 40, 1280, 720]] });
(window as any).earthReady = (async () => { e.setData(await fetch("/data.json").then((r) => r.json())); await e.ready; return true; })();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
(window as any).shot = async (p: Pose & { sun?: number; name?: string }) => {
  if (p.sun) e.setSun(p.sun); e.setPlaceName(p.name ?? null);
  for (let i = 0; i < 400; i++) { e.frame(p, 5000); await wait(400); if (i > 6 && !e.loading()) break; }
  for (let i = 0; i < 40; i++) { e.frame(p, 5000 + i * 16); await wait(30); } // let the layer fade fully in
};
