"use client";
// INTELLIGENCE → "Planet Earth" (feat/earth-globe): the photoreal Earth with today's stories, and a swoop down to towns with their
// local news. Behind ORBIT_UI_MOTION; "News weather" switches back to the previous view per device (and WebGL trouble does too).
// Scene: earth-scene.ts · data: earth-data-pure.ts · places/camera: earth-pure.ts · tiles: /api/earth/tile · local news: /api/earth/local.
import { useEffect, useRef, useState } from "react";
import { useUiMotion } from "../motion/motion";
import type { Hotspot } from "@/lib/geo";
import { earthData } from "@/lib/earth-data-pure";
import { introPath, SHOTS, type Pose, type TownNews } from "@/lib/earth-pure";
import { createEarth, EARTH_CSS, type Earth } from "./earth-scene";

const VIEW_KEY = "orbit.earth.view";

export default function EarthView({ reduced, paused, onActive }: { reduced: boolean; paused: boolean; onActive?: (on: boolean) => void }) {
  const motion = useUiMotion();
  const [off, setOff] = useState(true);
  useEffect(() => { try { setOff(localStorage.getItem(VIEW_KEY) === "weather"); } catch { setOff(false); } }, []);
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
        onTown: (t: TownNews) => { void e.focusPlace(t.lon, t.lat); e.flyTo(t.kind === "district" ? { lon: t.lon, lat: t.lat, alt: 5, tilt: 58, heading: 20 } : { lon: t.lon, lat: t.lat, alt: 14, tilt: 58, heading: 15 }); },
      });
    } catch { setFailed(true); return; }
    earth.current = e;
    e.start();
    if (reduced) e.flyTo(SHOTS.orbit, 1); else void e.ready.then(() => e.playPath(introPath().slice(0, 1)));
    let on = true;
    const load = async () => {
      const [g, l] = await Promise.all([
        fetch("/api/news/geo?hours=72").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/earth/local").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (on) e.setData(earthData((g?.hotspots ?? []) as Hotspot[], (l?.towns ?? []) as TownNews[]));
    };
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15 * 60_000);
    return () => { on = false; clearInterval(t); e.dispose(); earth.current = null; };
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
