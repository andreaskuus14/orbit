// Estonia real-data stills page: the app's scene with the Land Board layer (EE=1 in the URL) or without it (the OSM "before").
import { createEarth, EARTH_CSS } from "../../src/components/earth/earth-scene";
import type { Pose } from "../../src/lib/earth-pure";
const st = document.createElement("style"); st.textContent = EARTH_CSS + "html,body{margin:0;background:#000}.earth-host{--pr:0px!important}"; document.head.appendChild(st);
const host = document.createElement("div"); host.className = "earth-host"; document.body.appendChild(host);
const real = new URLSearchParams(location.search).has("ee");
const e = createEarth(host, { tileUrl: (k, z, x, y) => `/tile?k=${k}&z=${z}&x=${x}&y=${y}`, buildingsUrl: (x, y) => `/b?x=${x}&y=${y}`, sunMs: Date.parse("2026-06-20T10:00:00Z"), dpr: 1,
  ...(real ? { eeMeshUrl: (x: number, y: number) => `/ee3d?x=${x}&y=${y}`, eeOrthoUrl: (z: number, x: number, y: number) => `/eo?z=${z}&x=${x}&y=${y}`, eeMaxTiles: 12 } : {}) });
(window as any).earthReady = (async () => { e.setData(await fetch("/data.json").then((r) => r.json())); await e.ready; return true; })();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
(window as any).shot = async (p: Pose & { sun?: number; name?: string }) => {
  if (p.sun) e.setSun(p.sun); e.setPlaceName(p.name ?? null);
  for (let i = 0; i < 400; i++) { e.frame(p, 5000); await wait(400); if (i > 6 && !e.loading()) break; }
  for (let i = 0; i < 40; i++) { e.frame(p, 5000 + i * 16); await wait(30); } // let the layer fade fully in
};
