"use client";
// INTELLIGENCE: the one map. The photoreal Earth with today's stories, glowing borders and local-news towns at country zoom, and a
// swoop down to the real 3D cities. NewsGlobe owns the tab bar (IntelBar), the weather switch and Esc; this only draws the Earth.
// Scene: earth-scene.ts · data: earth-data-pure.ts · places/camera: earth-pure.ts · tiles: /api/earth/tile · local news: /api/earth/local.
import { useEffect, useRef, useState } from "react";
import type { Hotspot } from "@/lib/geo";
import { earthData } from "@/lib/earth-data-pure";
import { CLOSE_ALT, CLOSE_TILT, introPath, levelAt, SHOTS, type TownNews } from "@/lib/earth-pure";
import { inEstonia } from "@/lib/earth-region-pure";
import type { Place, Rect } from "@/lib/intel-view-pure";
import { EARTH_VIEW_EVENT } from "../intel/IntelBar";
import { createEarth, EARTH_CSS, type Earth } from "./earth-scene";

/** The chrome over the Earth, in host px (top bar, left list, panel, command bar): rings and labels keep out of it. Read every
 *  500 ms, not per frame (reading boxes every frame forced a layout each frame). */
const CHROME = ".intel-bar, .earth-search, .earth-side, .globe-country, .drawer:not(.drawer-out), .cmdbar, .voice-wake";
function chromeRects(host: HTMLElement): Rect[] {
  const h = host.getBoundingClientRect();
  return Array.from(document.querySelectorAll<HTMLElement>(CHROME)).filter((e) => !host.contains(e) && e.offsetWidth)
    .map((e) => { const r = e.getBoundingClientRect(); return [r.left - h.left - 8, r.top - h.top - 8, r.right - h.left + 8, r.bottom - h.top + 8] as Rect; });
}

export default function EarthView({ on, shot, weather, focus, reduced, paused, onPlace, onFail }: {
  on: boolean; shot: { place: Place; n: number } | null; weather: boolean; /** a list row hovered or picked: lights that place, and a picked one (fly) is flown to */ focus?: { lon: number; lat: number; fly?: boolean } | null; reduced: boolean; paused: boolean;
  onPlace?: (p: Place) => void; onFail?: () => void;
}) {
  const active = on;
  const wxRef = useRef(weather); wxRef.current = weather;
  const placeCb = useRef(onPlace); placeCb.current = onPlace;
  const shotRef = useRef(shot); shotRef.current = shot;

  const host = useRef<HTMLDivElement>(null), earth = useRef<Earth | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || !host.current) return;
    let e: Earth, inset = 0, zones: Rect[] = [], top = 70;
    const host0 = host.current;
    const measure = () => { // the stage (.intel-stage) is the free area NewsGlobe reserves; the chrome boxes keep labels clear
      const st = document.querySelector(".intel-stage")?.getBoundingClientRect(), hb = host0.getBoundingClientRect();
      inset = st ? Math.max(0, hb.right - st.right) : innerWidth >= 900 ? 512 : 0;
      top = st ? st.top - hb.top : 70;
      zones = chromeRects(host0);
    };
    measure();
    const mz = setInterval(measure, 500);
    try {
      e = createEarth(host.current, {
        tileUrl: (k, z, x, y) => `/api/earth/tile?k=${k}&z=${z}&x=${x}&y=${y}`,
        buildingsUrl: (x, y) => `/api/earth/buildings?x=${x}&y=${y}`,
        eeMeshUrl: (x, y) => `/api/earth/ee3d?x=${x}&y=${y}`, eePlacesUrl: (x, y) => `/api/earth/ee-places?x=${x}&y=${y}`, eeOrthoUrl: (z, x, y) => `/api/earth/ee-ortho?z=${z}&x=${x}&y=${y}`,
        rightInset: () => inset, // the planet sits in the free space left of the panel
        zones: () => zones, topLimit: () => top,
        onTown: (t: TownNews) => { void e.focusPlace(t.lon, t.lat); e.flyTo({ lon: t.lon, lat: t.lat, alt: CLOSE_ALT, tilt: CLOSE_TILT, heading: t.kind === "district" ? 20 : 15 }); },
      });
    } catch { clearInterval(mz); setFailed(true); onFail?.(); return; }
    earth.current = e;
    e.setWeather(wxRef.current, true);
    e.start();
    if (reduced) e.flyTo(SHOTS.orbit, 1); else void e.ready.then(() => { if (!shotRef.current) e.playPath(introPath().slice(0, 1)); }); // a tab press wins over the intro
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
    const iv = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15 * 60_000);
    // local news for the region in view outside Estonia: asked for only once the camera has rested 1.2 s below 2,500 km, and
    // only when it moved a real distance since the last ask (the server caches each region for 30 min as well)
    const names = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
    let last = "", still = 0, prev = "", sent = "", lvl = "";
    const watch = setInterval(() => {
      const p = e.view(), here = `${p.lon.toFixed(2)},${p.lat.toFixed(2)},${Math.round(Math.log2(p.alt))}`;
      const said = `${p.lon.toFixed(2)},${p.lat.toFixed(2)},${p.alt.toFixed(p.alt < 100 ? 1 : 0)}`;
      if (said !== sent) { sent = said; dispatchEvent(new CustomEvent(EARTH_VIEW_EVENT, { detail: { lon: p.lon, lat: p.lat, alt: p.alt } })); }
      const l = levelAt(p.alt); if (l !== lvl) { lvl = l; placeCb.current?.(l); }
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
    // a hidden browser tab draws nothing (rAF stops there anyway; this also drops the timers' work)
    const vis = () => { if (document.hidden || pausedRef.current) e.stop(); else e.start(); };
    document.addEventListener("visibilitychange", vis);
    return () => { on = false; clearInterval(iv); clearInterval(watch); clearInterval(mz); document.removeEventListener("visibilitychange", vis); e.dispose(); earth.current = null; };
  }, [active, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { earth.current?.setWeather(weather, reduced); }, [weather, reduced]);
  const fLon = focus?.lon, fLat = focus?.lat, fFly = focus?.fly;
  useEffect(() => {
    const e = earth.current; if (!e || !active) return;
    e.setFocus(fLon === undefined || fLat === undefined ? null : { lon: fLon, lat: fLat });
    if (fFly && fLon !== undefined && fLat !== undefined) e.flyTo({ lon: fLon, lat: fLat, alt: 3200, tilt: 0, heading: 0 }, reduced ? 1 : undefined);
  }, [fLon, fLat, fFly, active, reduced]);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  useEffect(() => { const e = earth.current; if (!e) return; if (paused || document.hidden) e.stop(); else e.start(); }, [paused]);
  // a tab in the bar: fly there (the first tab press after switching from another map lands here once the scene is up)
  useEffect(() => {
    if (!active || !shot) return;
    const go = () => { const e = earth.current; if (!e) return false; const p = SHOTS[shot.place];
      if (shot.place === "town") void e.focusPlace(p.lon, p.lat); e.flyTo(p, reduced ? 1 : undefined); return true; };
    if (go()) return;
    const t = setInterval(() => { if (go()) clearInterval(t); }, 100);
    return () => clearInterval(t);
  }, [shot, active, reduced]);

  if (!active || failed) return null;
  return <div className="earth-host z-[5]" ref={host}><style>{EARTH_CSS}</style></div>;
}
