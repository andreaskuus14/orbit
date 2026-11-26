// Motion-test page: the same scene as the app, driven frame by frame (window.renderAt).
import { createEarth, EARTH_CSS } from "../../src/components/earth/earth-scene";
import { introPath } from "../../src/lib/earth-pure";
const st = document.createElement("style"); st.textContent = EARTH_CSS + "html,body{margin:0;background:#000}.earth-host{--pr:0px!important}"; document.head.appendChild(st);
const host = document.createElement("div"); host.className = "earth-host"; document.body.appendChild(host);
const sun = Date.parse("2026-11-23T12:50:00Z");
const e = createEarth(host, { tileUrl: (k, z, x, y) => `/tile?k=${k}&z=${z}&x=${x}&y=${y}`, sunMs: sun, dpr: 1, preserve: true });
const path = introPath();
(window as any).earthReady = (async () => { e.setData(await (await fetch("/data.json")).json()); await e.ready; return true; })();
(window as any).renderAt = (ms: number) => { e.renderPathAt(path, ms); };
(window as any).pathLen = path.reduce((s, x) => s + x.move + x.hold, 0);
