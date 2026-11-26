// Bench page: the app's Earth scene at fixed shots; window.bench(pose) waits for tiles, then times frames (gl.finish each).
import { createEarth, EARTH_CSS } from "../../src/components/earth/earth-scene";
import type { Pose } from "../../src/lib/earth-pure";
const st = document.createElement("style"); st.textContent = EARTH_CSS + "html,body{margin:0;background:#000}.earth-host{--pr:0px!important}"; document.head.appendChild(st);
const host = document.createElement("div"); host.className = "earth-host"; document.body.appendChild(host);
const e = createEarth(host, { tileUrl: (k, z, x, y) => `/tile?k=${k}&z=${z}&x=${x}&y=${y}`, sunMs: Date.parse("2026-11-23T11:30:00Z"), dpr: 1 });
const gl = (host.querySelector("canvas") as HTMLCanvasElement).getContext("webgl2")!;
const w = window as any;
w.earthReady = (async () => { e.setData(await (await fetch("/data.json")).json()); await e.ready; return true; })();
w.bench = async (p: Pose, settleMs: number, n: number) => {
  e.stop(); e.flyTo(p, 1); e.start();
  await new Promise((ok) => setTimeout(ok, settleMs)); // the live loop runs meanwhile: detail tiles load as they would in the app
  e.stop();
  const px = new Uint8Array(4), ts: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); e.frame(p, 5000 + i * 16); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  return { median: ts[n >> 1], p90: ts[Math.floor(n * 0.9)] };
};
