"use client";
// INTELLIGENCE → "Planet Earth" (feat/earth-globe): the photoreal Earth with today's stories, and a swoop down to towns with their
// local news. Behind ORBIT_UI_MOTION; "News weather" switches back to the previous view per device (and WebGL trouble does too).
// Scene: earth-scene.ts · data: earth-data-pure.ts · places/camera: earth-pure.ts · tiles: /api/earth/tile · local news: /api/earth/local.
import { useEffect, useRef, useState } from "react";
import { motionActive, useUiMotion } from "../motion/motion";
import type { Hotspot } from "@/lib/geo";
import { earthData } from "@/lib/earth-data-pure";
import { introPath, SHOTS, type Pose, type TownNews } from "@/lib/earth-pure";
import { inEstonia } from "@/lib/earth-region-pure";
import { createEarth, EARTH_CSS, type Earth } from "./earth-scene";

const VIEW_KEY = "orbit.earth.view";

const weatherPicked = () => { try { return localStorage.getItem(VIEW_KEY) === "weather"; } catch { return false; } };
/** Will the Earth view show? Read at first render (this is client-only), so the old globe UI never flashes up first. */
export const earthWanted = () => typeof window !== "undefined" && motionActive() && !weatherPicked();

export default function EarthView({ reduced, paused, onActive }: { reduced: boolean; paused: boolean; onActive?: (on: boolean) => void }) {
  const motion = useUiMotion() || motionActive();
  const [off, setOff] = useState(() => typeof window === "undefined" || weatherPicked());
  const active = motion && !off;
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  const pick = (weather: boolean) => { setOff(weather); try { localStorage.setItem(VIEW_KEY, weather ? "weather" : "earth"); } catch { /* this tab only */ } };

  const host = useRef<HTMLDivElement>(null), earth = useRef<Earth | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || !host.current) return;
    let e: Earth;
    try {
      e = createEarth(host.current, {
        tileUrl: (k, z, x, y) => `/api/earth/tile?k=${k}&z=${z}&x=${x}&y=${y}`,
        buildingsUrl: (x, y) => `/api/earth/buildings?x=${x}&y=${y}`,
        rightInset: () => (innerWidth >= 900 ? 512 : 0), // the Intelligence panel's 32rem keeps its free space
        onTown: (t: TownNews) => { void e.focusPlace(t.lon, t.lat); e.flyTo(t.kind === "district" ? { lon: t.lon, lat: t.lat, alt: 5, tilt: 58, heading: 20 } : { lon: t.lon, lat: t.lat, alt: 14, tilt: 58, heading: 15 }); },
      });
    } catch { setFailed(true); return; }
    earth.current = e;
    e.start();
    if (reduced) e.flyTo(SHOTS.orbit, 1); else void e.ready.then(() => e.playPath(introPath().slice(0, 1)));
    let on = true, hs: Hotspot[] = [], ee: TownNews[] = [], region: TownNews[] = [];
    // the region in view first: it gets the labels and the card
    const draw = () => { if (on) e.setData(earthData(hs, [...region, ...ee])); };
    const load = async () => {
      const [g, l] = await Promise.all([
        fetch("/api/news/geo?hours=72").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/earth/local").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      hs = (g?.hotspots ?? []) as Hotspot[]; ee = (l?.towns ?? []) as TownNews[]; draw();
    };
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15 * 60_000);
    // local news for the region in view outside Estonia: asked for only once the camera has rested 1.2 s below 2,500 km, and
    // only when it moved a real distance since the last ask (the server caches each region for 30 min as well)
    const names = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
    let last = "", still = 0, prev = "";
    const watch = setInterval(() => {
      const p = e.view(), here = `${p.lon.toFixed(2)},${p.lat.toFixed(2)},${Math.round(Math.log2(p.alt))}`;
      still = here === prev ? still + 400 : 0; prev = here;
      if (still < 1200 || p.alt > 2500 || inEstonia(p.lon, p.lat)) { if ((inEstonia(p.lon, p.lat) || p.alt > 2500) && region.length) { region = []; last = ""; e.setPlaceName(null); draw(); } return; }
      const cell = `${Math.round(p.lon * 2) / 2},${Math.round(p.lat * 2) / 2},${p.alt > 150 ? "w" : "n"}`;
      if (cell === last || document.visibilityState !== "visible") return;
      last = cell;
      void fetch(`/api/earth/region?lon=${p.lon.toFixed(3)}&lat=${p.lat.toFixed(3)}&alt=${Math.round(p.alt)}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!on || !j) return;
        region = (j.towns ?? []) as TownNews[];
        e.setPlaceName(j.cc && names ? `${names.of(j.cc) ?? j.cc}, local news` : null);
        draw();
      }).catch(() => { last = ""; });
    }, 400);
    return () => { on = false; clearInterval(t); clearInterval(watch); e.dispose(); earth.current = null; };
  }, [active, reduced]);
  useEffect(() => { const e = earth.current; if (!e) return; if (paused) e.stop(); else e.start(); }, [paused]);

  if (!motion) return null;
  if (!active || failed) return off ? <button className="chip absolute top-3 left-3 z-[6]" onClick={() => pick(false)}>Planet view</button> : null;
  const go = (p: Pose, place?: { lon: number; lat: number }) => { if (place) void earth.current?.focusPlace(place.lon, place.lat); earth.current?.flyTo(p, reduced ? 1 : undefined); };
  return (
    <div className="earth-host z-[5]" ref={host}>
      <style>{EARTH_CSS}{`.earth-nav{position:absolute;left:32px;top:72px;display:flex;gap:6px;z-index:2}.earth-nav button{font:500 12px/1 var(--font-inter,Inter,sans-serif);color:#eef2f7;background:rgba(2,4,10,.55);border:1px solid rgba(238,242,247,.22);border-radius:6px;padding:7px 10px;cursor:pointer}.earth-nav button:hover{border-color:#f2b35e}`}</style>
      <nav className="earth-nav" aria-label="Places">
        <button onClick={() => go(SHOTS.orbit)}>Earth</button>
        <button onClick={() => go(SHOTS.country)}>Estonia</button>
        <button onClick={() => go(SHOTS.region)}>Towns</button>
        <button onClick={() => go(SHOTS.town)}>Tallinn</button>
        <button onClick={() => pick(true)}>News weather</button>
      </nav>
    </div>
  );
}
