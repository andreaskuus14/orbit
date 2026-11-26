"use client";
// INTELLIGENCE, orbit level as the owner's frame: a text-free Higgsfield plate of the Earth with live country pins and cards on it.
// Picking a country dollies into its pin and crossfades to the real 3D Earth under it (NewsGlobe mounts the Earth for the dive).
// Maths: lib/frame-map-pure.ts. The plate's art is static; everything written on it is live.
import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, type Hotspot } from "@/lib/geo";
import { flagPath } from "@/lib/intel-rank-pure";
import { dolly, fit, PLATE, pinsFor, plateOpacity } from "@/lib/frame-map-pure";

export default function FrameMap({ hotspots, hover, selected, diveTo, reduced, onPick, onDived, exploreLabel, onExplore }: {
  hotspots: Hotspot[]; hover: string | null; selected: string | null; diveTo: { lon: number; lat: number } | null; reduced: boolean;
  onPick: (name: string) => void; onDived: () => void; exploreLabel: string; onExplore: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [k, setK] = useState(0);
  useEffect(() => { // the free stage between the panels (.intel-stage); the plate fits inside it
    const el = host.current; if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect(), st = document.querySelector(".intel-stage")?.getBoundingClientRect();
      setBox(st ? { x: st.left - h.left, y: st.top - h.top, w: st.width, h: st.height } : { x: 0, y: 0, w: h.width, h: h.height });
    };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); addEventListener("resize", measure);
    return () => { ro.disconnect(); removeEventListener("resize", measure); };
  }, []);
  // the dive: k 0 -> 1 over 0.9 s (instant with reduced motion)
  const doneRef = useRef(onDived); doneRef.current = onDived;
  useEffect(() => {
    if (!diveTo) { setK(0); return; }
    if (reduced) { setK(1); doneRef.current(); return; }
    let raf = 0; const t0 = performance.now();
    const step = (now: number) => { const v = Math.min(1, (now - t0) / 900); setK(v); if (v < 1) raf = requestAnimationFrame(step); else doneRef.current(); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [diveTo, reduced]);

  const f = fit(box.w, box.h, box.x, box.y);
  const pins = useMemo(() => pinsFor(hotspots, { cards: 6 }), [hotspots]);
  const aim = diveTo ? pins.find((p) => selected && p.name === selected) : null;
  const ox = aim ? aim.x : PLATE.w / 2, oy = aim ? aim.y : PLATE.h / 2;
  if (!box.w) return <div ref={host} className="frame-map" aria-hidden />;
  return (
    <div ref={host} className="frame-map" style={{ opacity: plateOpacity(k) }}>
      <div className="frame-plate" style={{ left: f.x, top: f.y, width: PLATE.w, height: PLATE.h, transform: `scale(${f.s * dolly(k)})`, transformOrigin: `${ox}px ${oy}px` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ui/frames/world.jpg" width={PLATE.w} height={PLATE.h} alt="" draggable={false} />
        {pins.map((p) => {
          const h = hotspots.find((x) => x.name === p.name), on = p.name === (hover ?? selected), fl = flagPath(p.name);
          return (
            <div key={p.name}>
              <button className={`frame-pin${on ? " on" : ""}`} style={{ left: p.x, top: p.y, width: p.r * 2, height: p.r * 2 }} onClick={() => onPick(p.name)} aria-label={`${displayName(p.name)}, ${p.count}`} />
              {p.card && h && (
                <button className={`frame-card${on ? " on" : ""}`} style={{ left: p.cx, top: p.cy, width: 150 }} onClick={() => onPick(p.name)}>
                  <span className="fc-head">{fl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fl} alt="" />}{displayName(p.name)}<b>{p.count}</b></span>
                  <span className="fc-line">{h.stories[0]?.title ?? ""}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="frame-explore" onClick={onExplore}>{exploreLabel}</button>
    </div>
  );
}
