"use client";
// INTELLIGENCE → "News weather": the resting view as a weather map, and Play = a 60–75 s guided flythrough of today's briefing
// with its Kokoro audio. Behind ORBIT_UI_MOTION (off → nothing here, the classic globe as before); "Classic map" switches back
// per device. Drawing: weather-draw.ts · timing: news-weather-tour-pure.ts · data and rules: news-weather-pure.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUiMotion } from "../motion/motion";
import { useT } from "../i18n";
import type { Hotspot } from "@/lib/geo";
import { parseSnapshot, shortTitle, shouldReplace, sinceLast, snapshotOf, storyCues, tourPlan, weather, type Briefing } from "@/lib/news-weather-pure";
import { restView, safeFrame, storyView, subsolar, type Free, type View } from "@/lib/news-weather-motion-pure";
import { CTL0, frameAt, keyAction, nextClock, tourStartDelay, type Ctl } from "@/lib/news-weather-tour-pure";
import { tourLength, wxText } from "@/lib/news-weather-text-pure";
import { createWeatherDraw, TEXTURES, type TextureKind, type WeatherDraw, type WxModel } from "./weather-draw";

const VIEW_KEY = "orbit.newsWeather.view", SNAP_KEY = "orbit.newsWeather.snap.v1";
const PANEL = 512; // the Intelligence panel's width on wide screens (32rem): the guess until the real free frame is measured
type Audio = { el: HTMLAudioElement; url: string; ms: number };

export default function NewsWeatherLayer({ reduced, paused, onActive }: { reduced: boolean; paused: boolean; onActive: (on: boolean) => void }) {
  const motion = useUiMotion();
  const { lang } = useT();
  const text = wxText(lang);
  const [classic, setClassic] = useState(false);
  useEffect(() => { try { setClassic(localStorage.getItem(VIEW_KEY) === "classic"); } catch { /* no storage */ } }, []);
  const active = motion && !classic;
  useEffect(() => { onActive(active); }, [active, onActive]);
  const pick = (c: boolean) => { setClassic(c); try { localStorage.setItem(VIEW_KEY, c ? "classic" : "weather"); } catch { /* this tab only */ } };

  // ---- data ----
  const [hs, setHs] = useState<Hotspot[] | null>(null);
  const [brief, setBrief] = useState<Briefing | null>(null);
  useEffect(() => {
    if (!active) return;
    let on = true;
    const load = async () => {
      const [g, b] = await Promise.all([
        fetch("/api/news/geo?hours=72").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/briefings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!on) return;
      if (g?.hotspots) setHs(g.hotspots);
      const list: Briefing[] = b?.briefings ?? [];
      const day = 36 * 3600_000; // today's (or last night's) briefing with stories in it
      setBrief(list.find((x) => /\n###\s/.test(`\n${x.content}`) && Date.now() - Date.parse(x.created_at ?? "") < day) ?? null);
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 10 * 60_000);
    addEventListener("orbit:news", load);
    return () => { on = false; clearInterval(t); removeEventListener("orbit:news", load); };
  }, [active]);

  const wx = useMemo(() => (hs ? weather(hs, brief, lang) : null), [hs, brief, lang]);
  // "Since you last looked": compared with this device's last snapshot, which is replaced once it's 30+ min old.
  const [since, setSince] = useState<string[]>([]);
  useEffect(() => {
    if (!wx || !wx.systems.length) return;
    let prev = null;
    try { prev = parseSnapshot(localStorage.getItem(SNAP_KEY)); } catch { /* no storage */ }
    setSince(sinceLast(prev, wx.systems, wx.fronts, 3, lang).map((c) => c.text));
    const now = Date.now();
    if (shouldReplace(prev, now)) try { localStorage.setItem(SNAP_KEY, JSON.stringify(snapshotOf(wx.systems, wx.fronts, now))); } catch { /* fine */ }
  }, [wx, lang]);

  // ---- audio: fetched quietly once the view is up (made once by Kokoro, then served from disk) ----
  const audio = useRef<Audio | null>(null);
  useEffect(() => {
    if (!active || !brief || !wx?.stops.length) return;
    let gone = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/briefings/${brief.id}/audio`, { priority: "low" } as RequestInit);
        if (!r.ok || gone) return;
        const buf = await r.arrayBuffer();
        if (gone) return;
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
        let ms = 0;
        try { const ac = new AudioContext(); const dec = await ac.decodeAudioData(buf.slice(0)); ms = dec.duration * 1000; ac.close(); } catch { /* metadata below */ }
        const el = new Audio(url); el.preload = "auto";
        if (!ms) await new Promise<void>((ok) => { el.onloadedmetadata = () => ok(); setTimeout(ok, 3000); });
        audio.current = { el, url, ms: ms || el.duration * 1000 || 0 };
      } catch { /* no voice: the tour runs on its own clock */ }
    }, 2500);
    return () => { gone = true; clearTimeout(t); const a = audio.current; if (a) { a.el.pause(); URL.revokeObjectURL(a.url); audio.current = null; } };
  }, [active, brief, wx?.stops.length]);

  // ---- size + layout ----
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), draw = useRef<WeatherDraw | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  // The free frame: what the panel, top bar, search box, region chips and command bar leave uncovered, measured by sampling the
  // screen (elementFromPoint) at rest — on resize and every 2 s, since panels open and close. Kept still during the tour.
  const guess: Free = useMemo(() => ({ x: 0, y: 0, w: size.w >= 900 ? size.w - PANEL : size.w, h: size.h }), [size]);
  const [free, setFree] = useState<Free>(guess);
  useEffect(() => { setFree(guess); }, [guess]);
  const modeRef = useRef<"rest" | "tour" | "back">("rest");
  useEffect(() => {
    const el = box.current;
    if (!active || !el || !size.w) return;
    const measure = () => {
      if (modeRef.current !== "rest") return;
      const r = el.getBoundingClientRect(), C = 32, Rw = 24;
      const covered = Array.from({ length: Rw }, (_, y) => Array.from({ length: C }, (_, x) => {
        const hit = document.elementFromPoint(r.left + ((x + 0.5) / C) * r.width, r.top + ((y + 0.5) / Rw) * r.height);
        return !!hit && !el.contains(hit);
      }));
      const f = safeFrame(covered, r.width, r.height, guess);
      setFree((o) => (Math.abs(o.x - f.x) + Math.abs(o.y - f.y) + Math.abs(o.w - f.w) + Math.abs(o.h - f.h) < 4 ? o : f));
    };
    const t0 = setTimeout(measure, 300), t = setInterval(measure, 2000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [active, size, guess]);
  const drag = useRef({ dLon: 0, dLat: 0 });
  const rest0 = useMemo(() => (hs ? restView(hs.map((h) => ({ lon: h.lon, lat: h.lat, reports: h.count })), free) : null), [hs, free]);

  // ---- the tour ----
  const ctl = useRef<Ctl>(CTL0);
  const clock = useRef({ t: 0, last: 0, voiced: false, started: false });
  const [mode, setMode] = useState<Ctl["mode"]>("rest");
  const [live, setLive] = useState("");
  const lastView = useRef<View | null>(null);
  const plan = useRef<ReturnType<typeof tourPlan>>([]);

  const restNow = useCallback((): View | null => (rest0 ? { ...rest0, lon: rest0.lon + drag.current.dLon, lat: Math.max(-60, Math.min(60, rest0.lat + drag.current.dLat)) } : null), [rest0]);
  const play = useCallback(() => {
    if (!wx?.stops.length || ctl.current.mode !== "rest") return;
    const a = audio.current, n = wx.stops.length;
    const cues = a && brief && a.ms ? storyCues(brief.title, brief.content, a.ms) : null;
    plan.current = tourPlan(n, cues, a?.ms);
    clock.current = { t: -tourStartDelay, last: performance.now(), voiced: !!cues, started: false };
    ctl.current = { ...CTL0, mode: "tour", pressAt: performance.now() };
    modeRef.current = "tour"; setMode("tour");
  }, [wx, brief]);
  const back = useCallback(() => {
    if (ctl.current.mode !== "tour") return;
    audio.current?.el.pause();
    ctl.current = { ...ctl.current, mode: "back", backAt: performance.now(), backFrom: lastView.current };
    modeRef.current = "back"; setMode("back"); setLive("");
  }, []);
  const togglePause = useCallback(() => {
    const c = ctl.current; if (c.mode !== "tour") return;
    ctl.current = { ...c, paused: !c.paused };
    const a = audio.current;
    if (clock.current.voiced && a && clock.current.started) { if (ctl.current.paused) a.el.pause(); else a.el.play().catch(() => {}); }
  }, []);
  const next = useCallback(() => {
    if (ctl.current.mode !== "tour") return;
    const t = nextClock(plan.current, Math.max(0, clock.current.t));
    clock.current.t = t;
    const a = audio.current;
    if (clock.current.voiced && a) a.el.currentTime = t / 1000;
  }, []);

  useEffect(() => {
    if (mode !== "tour") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      const k = keyAction(e.key, ctl.current.mode);
      if (!k) return;
      e.preventDefault();
      if (k === "pause") togglePause(); else if (k === "next") next(); else if (k === "back") back();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [mode, togglePause, next, back]);

  // ---- the frame loop ----
  const [hover, setHoverS] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const setHover = (h: string | null) => { hoverRef.current = h; setHoverS(h); };
  const [playRect, setPlayRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!active || !wx || !rest0 || !cv.current || !size.w) return;
    if (!draw.current) {
      const css = getComputedStyle(document.documentElement), v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
      const d0 = (draw.current = createWeatherDraw(cv.current, { sans: `${v("--font-inter", "Inter")}, system-ui, sans-serif`, serif: `${v("--font-serif", "'Source Serif 4'")}, Georgia, serif` }));
      for (const k of Object.keys(TEXTURES) as TextureKind[]) { // the globe's pictures, quietly after the first frame (flat land until then)
        const im = new Image(); im.decoding = "async"; im.onload = () => d0.setTexture(k, im); im.src = TEXTURES[k];
      }
    }
    const d = draw.current;
    const views = wx.stops.map((s) => storyView(s.system, free));
    const n = wx.stops.length;
    let chapters: { title: string; start: number; end: number }[] = [], chFor: unknown = null;
    const model: WxModel = {
      systems: wx.systems, fronts: wx.fronts, isobars: wx.isobars, hpa: wx.hpa, forecast: wx.forecast, since, text,
      title: `${text.title} · ${new Date().toLocaleDateString(lang === "et" ? "et-EE" : "en-GB", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase())}`,
      playSub: n ? tourLength(n, audio.current?.ms || tourPlan(n).at(-1)!.end, lang) : "", canPlay: n > 0,
    };
    let raf = 0, lastIdx = -2, lastDraw = 0;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (paused || document.visibilityState !== "visible") return;
      const c = ctl.current;
      if (reduced && c.mode === "rest" && now - lastDraw < 500) return; // reduced motion at rest: a still picture, refreshed slowly
      lastDraw = now;
      // tour clock: the audio's time once it plays, otherwise our own clock (paused = stopped)
      const k = clock.current, a = audio.current, dt = Math.min(100, now - k.last); k.last = now;
      if (c.mode === "tour" && !c.paused) {
        if (k.voiced && a && k.started) k.t = a.el.currentTime * 1000;
        else { k.t += dt; if (k.voiced && a && !k.started && k.t >= 0) { k.started = true; a.el.currentTime = 0; a.el.play().catch(() => { k.voiced = false; }); } }
      }
      const rest = restNow()!;
      const x = { rest, views, stops: wx.stops, plan: plan.current, reduced };
      const f = frameAt(c, now, k.t, x);
      if (c.mode === "back" && now - c.backAt > 1900) { ctl.current = CTL0; modeRef.current = "rest"; setMode("rest"); }
      if (f.done && c.mode === "tour") { lastView.current = f.view; back(); }
      lastView.current = f.view;
      const st = f.i >= 0 && c.mode === "tour" ? wx.stops[f.i] : null;
      if (chFor !== plan.current) { chFor = plan.current; chapters = plan.current.map((q, i) => ({ title: shortTitle(wx.stops[i]?.headline ?? "", 30), start: q.start, end: q.end })); }
      if (f.i !== lastIdx) { lastIdx = f.i; setLive(st ? `${f.i + 1} / ${n}. ${st.headline}. ${st.lines.join(" ")}` : ""); }
      const p = st ? plan.current[f.i] : null;
      d.draw(model, { W: size.w, H: size.h, dpr, free, view: f.view, now, reduced, rest: f.rest, hover: hoverRef.current, sun: subsolar(Date.now()),
        tour: st && f.scene && p ? { stop: st, prev: f.i > 0 ? wx.stops[f.i - 1] : null, scene: f.scene, idx: f.i, n, from: f.from, paused: c.paused, voiced: k.voiced,
          dur: p.end - p.start, clock: k.t, chapters } : null });
    };
    raf = requestAnimationFrame(tick);
    requestAnimationFrame(() => setPlayRect(d.playRect()));
    return () => cancelAnimationFrame(raf);
  }, [active, wx, rest0, free, size, since, text, lang, paused, reduced, restNow, back]);

  // ---- pointer: drag to turn the resting globe, hover a storm to light its label ----
  const down = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { if (ctl.current.mode === "rest") { down.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); } };
  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (down.current && rest0) {
      const k = 90 / rest0.scale;
      drag.current = { dLon: drag.current.dLon - (e.clientX - down.current.x) * k, dLat: drag.current.dLat + (e.clientY - down.current.y) * k };
      down.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (r && draw.current && ctl.current.mode === "rest") { const h = draw.current.hit(e.clientX - r.left, e.clientY - r.top); if (h !== hover) setHover(h); }
  };
  const onUp = () => { down.current = null; };

  if (!motion) return null;
  if (!active) return <button className="chip absolute bottom-36 left-3" onClick={() => pick(false)}>{text.weatherMap}</button>;
  return (
    <div ref={box} className="absolute inset-0 select-none" style={{ background: "#18191b", touchAction: "none", cursor: hover ? "pointer" : down.current ? "grabbing" : "grab" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label={text.title}>
      <canvas ref={cv} className="absolute inset-0 h-full w-full" aria-hidden />
      <p className="sr-only">{wx ? `${text.title}. ${wx.forecast} ${since.join(". ")}` : ""}</p>
      <div className="sr-only" aria-live="polite">{live}</div>
      {mode === "rest" && playRect && (
        <>
          <button className="absolute rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" style={{ left: playRect.x, top: playRect.y, width: playRect.w, height: playRect.h, background: "transparent" }}
            onClick={play} onPointerDown={(e) => e.stopPropagation()} disabled={!wx?.stops.length} aria-label={wx?.stops.length ? text.play : text.noBriefing} />
          <button className="chip absolute" style={{ left: playRect.x + playRect.w - 120, top: playRect.y - 44, width: 120 }} onPointerDown={(e) => e.stopPropagation()} onClick={() => pick(true)}>{text.classic}</button>
        </>
      )}
      {mode === "tour" && <button className="sr-only" onClick={back}>{text.keys}</button>}
    </div>
  );
}
