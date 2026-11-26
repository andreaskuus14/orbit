"use client";
// INTELLIGENCE as the owner's frames: a text-free Higgsfield plate per level (world, Europe, Estonia, Tallinn old town, village) with live
// pins and cards on it. A pick dollies into its pin and crossfades to the next plate (or to the real 3D Earth); the plates lean with the
// pointer through a depth map when one exists. The world plate carries the live news weather. Maths: lib/frame-map-pure.ts,
// lib/frame-parallax-pure.ts. Towns: /api/earth/local.
import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, type Hotspot } from "@/lib/geo";
import { flagPath } from "@/lib/intel-rank-pure";
import { dolly, fit, FRAME_IDS, FRAMES, PLATE, pinsFor, plateOpacity, type FrameId } from "@/lib/frame-map-pure";
import { PARALLAX, pointerNorm } from "@/lib/frame-parallax-pure";
import type { TownNews } from "@/lib/earth-pure";
import { safeHref } from "../CountryDash";
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

function Plate({ id, items, hs, active, hover, selected, onPick, reduced }: { id: FrameId; items: Item[]; hs: Hotspot[]; active: boolean; hover: string | null; selected: string | null; onPick: (p: Pick) => void; reduced: boolean }) {
  const def = FRAMES[id], pins = useMemo(() => pinsFor(items, { frame: id, cards: id === "world" ? 6 : id === "europe" ? 8 : 7 }), [items, id]);
  const byName = useMemo(() => new Map(items.map((i) => [i.name, i])), [items]);
  const cv = useRef<HTMLCanvasElement>(null), [gl, setGl] = useState(false), glRef = useRef<Awaited<ReturnType<typeof createPlateGL>>>(null);
  useEffect(() => { // depth parallax when the plate has a depth map and WebGL
    if (!cv.current || reduced) return;
    let gone = false;
    void createPlateGL(cv.current, def.src, def.src.replace(".jpg", "-depth.png"), PARALLAX[id]).then((g) => { if (gone) { g?.dispose(); return; } glRef.current = g; setGl(!!g); });
    return () => { gone = true; glRef.current?.dispose(); glRef.current = null; setGl(false); };
  }, [id, def.src, reduced]);
  const sym = id === "world" || id === "europe" || id === "estonia";
  return (
    <div className="frame-plate-in" onPointerMove={active ? (e) => { const b = e.currentTarget.getBoundingClientRect(), n = pointerNorm(e.clientX - b.left, e.clientY - b.top, b.width, b.height); glRef.current?.setTarget(n[0], n[1]); } : undefined}>
      <canvas ref={cv} className="frame-gl" width={PLATE.w} height={PLATE.h} style={{ display: gl ? "block" : "none" }} aria-hidden />
      {!gl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={def.src} width={PLATE.w} height={PLATE.h} alt="" draggable={false} />}
      {id === "world" && <FrameWeather hotspots={hs} reduced={reduced} />}
      {active && pins.map((p) => {
        const it = byName.get(p.name); if (!it) return null;
        const on = p.name === (hover ?? selected), fl = it.flag ? flagPath(p.name) : null, drill = sym;
        const body = (<>
          <span className="fc-head">{fl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fl} alt="" />}{displayName(p.name)}<b>{p.count}</b></span>
          <span className="fc-line">{it.line}</span></>);
        return (
          <div key={p.name}>
            {sym && <button className={`frame-pin${on ? " on" : ""}`} style={{ left: p.x, top: p.y, width: p.r * 2, height: p.r * 2 }} onClick={() => onPick({ name: it.name, lon: it.lon, lat: it.lat, kind: it.kind })} aria-label={`${displayName(p.name)}, ${p.count}`} />}
            {p.card && (drill || !it.url
              ? <button className={`frame-card${on ? " on" : ""}`} style={{ left: p.cx, top: p.cy, width: 150 }} onClick={() => onPick({ name: it.name, lon: it.lon, lat: it.lat, kind: it.kind })}>{body}</button>
              : <a className={`frame-card${on ? " on" : ""}`} style={{ left: p.cx, top: p.cy, width: 190 }} href={safeHref(it.url!)} target="_blank" rel="noreferrer noopener">{body}</a>)}
          </div>
        );
      })}
    </div>
  );
}

export default function FrameMap({ level, hotspots, hover, selected, diveTo, reduced, onPick, onDived, exploreLabel, onExplore }: {
  level: FrameId; hotspots: Hotspot[]; hover: string | null; selected: string | null; diveTo: { lon: number; lat: number } | null; reduced: boolean;
  onPick: (from: FrameId, p: Pick) => void; onDived: () => void; exploreLabel: string; onExplore: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => { // the free stage between the panels (.intel-stage); the plate fits inside it
    const el = host.current; if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect(), st = document.querySelector(".intel-stage")?.getBoundingClientRect();
      setBox(st ? { x: st.left - h.left, y: st.top - h.top, w: st.width, h: st.height } : { x: 0, y: 0, w: h.width, h: h.height });
    };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); addEventListener("resize", measure);
    return () => { ro.disconnect(); removeEventListener("resize", measure); };
  }, []);

  // towns for the three Estonian plates, asked for once
  const [towns, setTowns] = useState<TownNews[]>([]);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || level === "world" || level === "europe") return; asked.current = true;
    void fetch("/api/earth/local").then((r) => (r.ok ? r.json() : null)).then((j) => setTowns((j?.towns ?? []) as TownNews[])).catch(() => { asked.current = false; });
  }, [level]);

  // a level change: the old plate dollies toward the picked pin and fades out, the new one fades in from a little closer
  const [shown, setShown] = useState<FrameId>(level), [from, setFrom] = useState<FrameId | null>(null), [tk, setTk] = useState(1);
  const aim = useRef({ x: PLATE.w / 2, y: PLATE.h / 2 }), deeper = useRef(true);
  const lastPick = useRef<Pick | null>(null);
  useEffect(() => {
    if (level === shown) return;
    deeper.current = FRAME_IDS.indexOf(level) > FRAME_IDS.indexOf(shown);
    setFrom(shown); setShown(level);
    if (reduced) { setTk(1); setFrom(null); return; }
    setTk(0); let raf = 0; const t0 = performance.now();
    const step = (now: number) => { const v = Math.min(1, (now - t0) / 900); setTk(v); if (v < 1) raf = requestAnimationFrame(step); else setFrom(null); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  // the dive to the real 3D Earth
  const [dk, setDk] = useState(0), doneRef = useRef(onDived); doneRef.current = onDived;
  useEffect(() => {
    if (!diveTo) { setDk(0); return; }
    if (reduced) { setDk(1); doneRef.current(); return; }
    let raf = 0; const t0 = performance.now();
    const step = (now: number) => { const v = Math.min(1, (now - t0) / 900); setDk(v); if (v < 1) raf = requestAnimationFrame(step); else doneRef.current(); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [diveTo, reduced]);

  const itemsBy = useMemo(() => Object.fromEntries(FRAME_IDS.map((id) => [id, itemsFor(id, hotspots, towns)])) as Record<FrameId, Item[]>, [hotspots, towns]);
  const f = fit(box.w, box.h, box.x, box.y);
  if (!box.w) return <div ref={host} className="frame-map" aria-hidden />;
  const pick = (id: FrameId, p: Pick) => {
    lastPick.current = p;
    const def = FRAMES[id], items = itemsBy[id], pin = items.find((i) => i.name === p.name);
    if (pin && !def.slots) { const q = pinsFor(items, { frame: id }).find((x) => x.name === p.name); if (q) aim.current = { x: q.x, y: q.y }; }
    onPick(id, p);
  };
  const layer = (id: FrameId, op: number, scale: number, key: string, active: boolean) => (
    <div key={key} className="frame-plate" style={{ left: f.x, top: f.y, width: PLATE.w, height: PLATE.h, opacity: op, transform: `scale(${f.s * scale})`, transformOrigin: `${aim.current.x}px ${aim.current.y}px`, pointerEvents: active ? "auto" : "none" }}>
      <Plate id={id} items={itemsBy[id]} hs={hotspots} active={active} hover={hover} selected={selected} onPick={(p) => pick(id, p)} reduced={reduced} />
    </div>
  );
  const eased = tk * tk * (3 - 2 * tk), enter = deeper.current ? 1.18 - 0.18 * eased : 0.86 + 0.14 * eased;
  return (
    <div ref={host} className="frame-map" style={{ opacity: plateOpacity(dk) }} data-level={shown}>
      {from && layer(from, plateOpacity(tk), deeper.current ? dolly(tk, 2.6) : 1 - 0.14 * eased, `o-${from}`, false)}
      {layer(shown, from ? Math.min(1, eased * 1.6) : 1, from ? enter : dolly(dk), `n-${shown}`, !from)}
      <button className="frame-explore" onClick={onExplore}>{exploreLabel}</button>
    </div>
  );
}
