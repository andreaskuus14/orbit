"use client";
// INTELLIGENCE as the owner's frames: a text-free Higgsfield plate per level (world, Europe, Estonia, Tallinn old town, village) with live
// pins and cards on it. A pick dollies into its pin and crossfades to the next plate (or to the real 3D Earth); the plates lean with the
// pointer through a depth map when one exists. The world plate carries the live news weather. Maths: lib/frame-map-pure.ts,
// lib/frame-parallax-pure.ts. Towns: /api/earth/local.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayName, type Hotspot } from "@/lib/geo";
import { flagPath } from "@/lib/intel-rank-pure";
import { cover, dollyTransform, FOCUS, FRAME_IDS, FRAMES, PAINTED_STORMS, PLATE, pinsFor, pointOnScreen, rectToPlate, type FrameId, type Rect } from "@/lib/frame-map-pure";
import { plateGrade, stormsFrom, WORLD_GRADE } from "@/lib/frame-fx-pure";
import { PARALLAX, pointerNorm } from "@/lib/frame-parallax-pure";
import type { TownNews } from "@/lib/earth-pure";
import { safeHref } from "../CountryDash";
import { EARTH_CSS } from "../earth/earth-scene";
import FrameWeather from "./FrameWeather";
import { createPlateGL } from "./plate-gl";

export type Pick = { name: string; lon: number; lat: number; kind?: string };
type Item = { name: string; lon: number; lat: number; count: number; line: string; url?: string; kind?: string; flag?: boolean };

/** What each level lists: countries on the two big plates, towns on Estonia, the latest Tallinn stories, the busiest village. */
function itemsFor(level: FrameId, hs: Hotspot[], towns: TownNews[]): Item[] {
  if (level === "world" || level === "europe") return hs.map((h) => ({ name: h.name, lon: h.lon, lat: h.lat, count: h.count, line: h.stories[0]?.title ?? "", flag: true }));
  const mk = (t: TownNews): Item => ({ name: t.name, lon: t.lon, lat: t.lat, count: t.count, line: t.stories[0]?.title ?? "", url: t.stories[0]?.url, kind: t.kind });
  if (level === "estonia") return towns.filter((t) => t.count > 0 && t.stories.length).map(mk);
  if (level === "tallinn") return towns.filter((t) => t.count > 0 && t.stories.length && t.lon > 24.55 && t.lon < 24.95 && t.lat > 59.35 && t.lat < 59.5).map(mk);
  return towns.filter((t) => t.kind === "village" && t.count > 0 && t.stories.length).map(mk);
}

/** One plate: the picture (GL with depth parallax, or the flat image), and the world's live weather. Pins are drawn apart, in screen px. */
function Plate({ id, hs, active, reduced, ui }: { id: FrameId; hs: Hotspot[]; active: boolean; reduced: boolean; ui: number }) {
  const def = FRAMES[id];
  const cv = useRef<HTMLCanvasElement>(null), [gl, setGl] = useState(false), glRef = useRef<Awaited<ReturnType<typeof createPlateGL>>>(null);
  useEffect(() => { // depth parallax when the plate has a depth map and WebGL
    if (!cv.current || reduced) return;
    let gone = false;
    void createPlateGL(cv.current, def.src, def.src.replace(".jpg", "-depth.png"), PARALLAX[id], { ...plateGrade(id), ...(id === "world" ? { storms: stormsFrom(PAINTED_STORMS), calm: WORLD_GRADE.tint, tint: WORLD_GRADE.tintK } : {}) }).then((g) => { if (gone) { g?.dispose(); return; } glRef.current = g; setGl(!!g); });
    return () => { gone = true; glRef.current?.dispose(); glRef.current = null; setGl(false); };
  }, [id, def.src, reduced]);
  useEffect(() => { // the pointer leans the plate (listened on the window: the panels sit over the plate)
    if (!active || reduced) return;
    const mv = (e: PointerEvent) => { const n = pointerNorm(e.clientX, e.clientY, innerWidth, innerHeight); glRef.current?.setTarget(n[0], n[1]); };
    addEventListener("pointermove", mv, { passive: true }); return () => removeEventListener("pointermove", mv);
  }, [active, reduced]);
  return (
    <div className="frame-plate-in">
      <canvas ref={cv} className="frame-gl" width={PLATE.w} height={PLATE.h} style={{ display: gl ? "block" : "none" }} aria-hidden />
      {!gl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={def.src} width={PLATE.w} height={PLATE.h} alt="" draggable={false} />}
      {id === "world" && <FrameWeather hotspots={hs} reduced={reduced} ui={ui} />}
    </div>
  );
}

type Layer = { id: FrameId; key: number; phase: "enter" | "on" | "leave"; deeper: boolean };
type View = { W: number; H: number; free: Rect; keep: Rect[] };
const KEEP = ".ip-top, .ip-strip, .earth-side, .globe-country, .intel-bar, .earth-search, .drawer:not(.drawer-out), .cmdbar, .voice-wake";

export default function FrameMap({ level, hotspots, hover, selected, diveTo, reduced, onPick, onDived, exploreLabel, onExplore }: {
  level: FrameId; hotspots: Hotspot[]; hover: string | null; selected: string | null; diveTo: { lon: number; lat: number } | null; reduced: boolean;
  onPick: (from: FrameId, p: Pick) => void; onDived: () => void; exploreLabel: string; onExplore: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // The plate is the background of the whole view (cover-fit, behind every panel). The free area between the panels (.intel-stage) only
  // decides where the picture is centred and where pins and cards may sit. Read every 400 ms and only kept when it changed.
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    let last = "";
    const measure = () => {
      const h = el.getBoundingClientRect(); if (!h.width) return;
      const rel = (r: DOMRect): Rect => ({ x: Math.round(r.left - h.left), y: Math.round(r.top - h.top), w: Math.round(r.width), h: Math.round(r.height) });
      const st = document.querySelector(".intel-stage")?.getBoundingClientRect();
      const v: View = { W: Math.round(h.width), H: Math.round(h.height), free: st && st.width > 50 ? rel(st) : { x: 0, y: 0, w: Math.round(h.width), h: Math.round(h.height) },
        keep: Array.from(document.querySelectorAll<HTMLElement>(KEEP)).filter((e) => !el.contains(e) && e.offsetWidth).map((e) => rel(e.getBoundingClientRect())) };
      const k = JSON.stringify(v); if (k !== last) { last = k; setView(v); }
    };
    measure(); const iv = setInterval(measure, 400); const ro = new ResizeObserver(measure); ro.observe(el); addEventListener("resize", measure);
    return () => { clearInterval(iv); ro.disconnect(); removeEventListener("resize", measure); };
  }, []);

  // preload the other plates and their depth maps once the first one is up, so a pick never waits on a download
  useEffect(() => {
    const t = setTimeout(() => { for (const id of FRAME_IDS) for (const u of [FRAMES[id].src, FRAMES[id].src.replace(".jpg", "-depth.png")]) { const i = new Image(); i.src = u; } }, 800);
    return () => clearTimeout(t);
  }, []);

  // towns for the three Estonian plates, asked for once
  const [towns, setTowns] = useState<TownNews[]>([]);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || level === "world" || level === "europe") return; asked.current = true;
    void fetch("/api/earth/local").then((r) => (r.ok ? r.json() : null)).then((j) => setTowns((j?.towns ?? []) as TownNews[])).catch(() => { asked.current = false; });
  }, [level]);

  // Level changes run on CSS transitions (transform and opacity only, on the compositor): the old plate dollies into the picked pin and
  // fades, the new one eases in from a little closer. State changes only at the start and the end, so React renders twice, not per frame.
  const keyN = useRef(1), aim = useRef({ x: PLATE.w / 2, y: PLATE.h / 2 });
  const [layers, setLayers] = useState<Layer[]>([{ id: level, key: 0, phase: "enter", deeper: true }]); // the first plate fades in too: no jump on load
  useEffect(() => {
    setLayers((ls) => {
      const cur = ls.find((l) => l.phase !== "leave"); if (!cur || cur.id === level) return ls;
      const deeper = FRAME_IDS.indexOf(level) > FRAME_IDS.indexOf(cur.id), k = keyN.current++;
      if (reduced) return [{ id: level, key: k, phase: "on", deeper }];
      return [...ls.filter((l) => l.phase !== "leave").map((l) => ({ ...l, phase: "leave" as const, deeper })), { id: level, key: k, phase: "enter", deeper }];
    });
  }, [level, reduced]);
  useEffect(() => {
    if (!view || !layers.some((l) => l.phase === "enter")) return;
    const r1 = requestAnimationFrame(() => requestAnimationFrame(() => setLayers((ls) => ls.map((l) => (l.phase === "enter" ? { ...l, phase: "on" } : l)))));
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => l.phase !== "leave")), 1000);
    return () => { cancelAnimationFrame(r1); clearTimeout(t); };
  }, [layers, !!view]); // eslint-disable-line react-hooks/exhaustive-deps
  // the dive to the real 3D Earth: the plate dollies in and fades, then NewsGlobe drops it
  const doneRef = useRef(onDived); doneRef.current = onDived;
  useEffect(() => {
    if (!diveTo) return;
    if (reduced) { doneRef.current(); return; }
    const t = setTimeout(() => doneRef.current(), 950); return () => clearTimeout(t);
  }, [diveTo, reduced]);

  const itemsBy = useMemo(() => Object.fromEntries(FRAME_IDS.map((id) => [id, itemsFor(id, hotspots, towns)])) as Record<FrameId, Item[]>, [hotspots, towns]);
  const active = layers.find((l) => l.phase === "on") ?? layers[layers.length - 1];
  const camOf = useCallback((id: FrameId) => view ? cover(view.W, view.H, FOCUS[id], { x: view.free.x + view.free.w * 0.42, y: view.free.y + view.free.h / 2 }) : null, [view]);
  const cam = camOf(active.id);
  const pins = useMemo(() => {
    if (!view || !cam || diveTo || layers.length > 1) return [];
    const cw = 150 / cam.s, ch = 46 / cam.s, within = rectToPlate({ x: 8, y: view.free.y, w: view.W - 16, h: view.free.h }, cam); // anywhere on the picture that no panel covers
    const keep = view.keep.map((r) => rectToPlate(r, cam));
    return pinsFor(itemsBy[active.id], { frame: active.id, cards: active.id === "world" ? 6 : active.id === "europe" ? 8 : 7, cardW: active.id === "tallinn" || active.id === "village" ? 190 / cam.s : cw, cardH: ch, keepOut: keep, within: FRAMES[active.id].slots ? undefined : within });
  }, [view, cam, diveTo, layers.length, itemsBy, active.id]);
  if (!view || !cam) return <div ref={host} className="frame-map" aria-hidden />;

  const pick = (id: FrameId, p: Pick) => {
    const q = pins.find((x) => x.name === p.name); if (q && !FRAMES[id].slots) aim.current = { x: q.x, y: q.y };
    onPick(id, p);
  };
  const layerStyle = (l: Layer): React.CSSProperties => {
    const c = camOf(l.id)!, a = aim.current;
    const d = diveTo && l.phase === "on" ? 3.4 : l.phase === "on" ? 1 : l.phase === "leave" ? (l.deeper ? 2.6 : 0.86) : (l.deeper ? 1.18 : 0.86);
    const t = dollyTransform(c, a, d);
    return { width: PLATE.w, height: PLATE.h, opacity: l.phase === "on" ? 1 : 0, transform: `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.scale})`, pointerEvents: "none" };
  };
  const dive = !!diveTo;
  const strip = view.keep.find((r) => r.w > 300 && r.y > view.H * 0.5 && r.h < 200), floor = strip ? strip.y : view.free.y + view.free.h; // above the stories strip, never under it
  const ex = { right: view.W - (view.free.x + view.free.w) + 12, bottom: view.H - floor + 12 };
  return (
    <div ref={host} className={`frame-map${dive ? " diving" : ""}${reduced ? " still" : ""}`} data-level={active.id}>
      <style>{EARTH_CSS}</style>
      {layers.map((l) => (
        <div key={l.key} className="frame-plate" style={layerStyle(l)}>
          <Plate id={l.id} hs={hotspots} active={l.phase === "on"} reduced={reduced} ui={1 / camOf(l.id)!.s} />
        </div>
      ))}
      <div className="frame-pins">
        {pins.map((p) => {
          const it = itemsBy[active.id].find((i) => i.name === p.name); if (!it) return null;
          const sc = pointOnScreen({ x: p.x, y: p.y }, cam), cs = pointOnScreen({ x: p.cx, y: p.cy }, cam);
          const on = p.name === (hover ?? selected), fl = it.flag ? flagPath(p.name) : null, drill = active.id === "world" || active.id === "europe" || active.id === "estonia", wide = !drill && !!it.url;
          const body = (<>
            <span className="fc-head">{fl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fl} alt="" />}{displayName(p.name)}<b>{p.count}</b></span>
            <span className="fc-line">{it.line}</span></>);
          const go = () => pick(active.id, { name: it.name, lon: it.lon, lat: it.lat, kind: it.kind });
          return (
            <div key={p.name}>
              {drill && <button className={`frame-pin${on ? " on" : ""}`} style={{ left: sc.x, top: sc.y, width: p.r * 2, height: p.r * 2 }} onClick={go} aria-label={`${displayName(p.name)}, ${p.count}`} />}
              {p.card && (wide
                ? <a className={`frame-card${on ? " on" : ""}`} style={{ left: cs.x, top: cs.y, width: 190 }} href={safeHref(it.url!)} target="_blank" rel="noreferrer noopener">{body}</a>
                : <button className={`frame-card${on ? " on" : ""}`} style={{ left: cs.x, top: cs.y, width: 150 }} onClick={go}>{body}</button>)}
            </div>
          );
        })}
      </div>
      <button className="frame-explore" style={ex} onClick={onExplore}>{exploreLabel}</button>
    </div>
  );
}
