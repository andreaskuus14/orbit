"use client";
// CORE's thinking indicator (Arrival logogram): a real glyph of the alien script (alien-script-pure) that forms from
// several points at once, with no start and no stroke order, blooms and fades like ink in water. Pure SVG + CSS
// (globals.css .ink-*): no frame loop. Turbulence displacement gives the ink edge; each arc grows outward from its own
// midpoint (dash centred on it), ticks and dots grow as tendrils.
import { useId, useState } from "react";
import { STEPS, strokes } from "@/lib/alien-script-pure";

const R = 38;
const pct = (x: number) => ((x % 1) + 1) % 1 * 100;
function make() { // a fresh logogram per busy spell
  const r = Math.random, s = strokes(Math.floor(r() * 4096));
  // glyph angles run ccw with y up; an SVG circle's path runs clockwise from 3 o'clock with y down: fraction = -angle
  const arcs = s.flatMap((k) => k.k === "arc" ? [{ rr: k.r * R, c: pct(-(k.a0 + k.a1) / 2 / STEPS), l: ((k.a1 - k.a0) / STEPS) * 100, w: k.r === 1 ? 2.6 : 1.8, d: r() * 0.12 }] : []);
  const tendrils = s.flatMap((k) => k.k === "line" ? [{ x1: k.x0 * R, y1: -k.y0 * R, x2: k.x1 * R, y2: -k.y1 * R, w: 1.5, d: r() * 0.15 }]
    : k.k === "dot" ? [{ x1: k.x * R, y1: -k.y * R, x2: k.x * R + 0.01, y2: -k.y * R, w: 3.2, d: r() * 0.15 }] : []);
  return { arcs, tendrils, seed: Math.floor(r() * 99) };
}

export function InkGlyph({ reduced }: { reduced: boolean }) {
  const id = useId().replace(/:/g, "");
  const [g] = useState(make);
  return (
    <svg aria-hidden className={`ink-glyph${reduced ? " ink-still" : ""}`} viewBox="-60 -60 120 120">
      <filter id={`ink${id}`} x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed={g.seed} />
        <feDisplacementMap in="SourceGraphic" scale="5" />
      </filter>
      <g filter={`url(#ink${id})`} fill="none" stroke="currentColor" strokeLinecap="round">
        {g.arcs.map((a, i) => (
          <circle key={i} className="ink-arc" r={a.rr} pathLength={100} strokeWidth={a.w}
            style={{ ["--c" as string]: a.c, ["--l" as string]: a.l, animationDelay: `${a.d}s` }} />
        ))}
        {g.tendrils.map((t, i) => (
          <line key={i} className="ink-tendril" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} pathLength={100} strokeWidth={t.w} style={{ animationDelay: `${t.d}s` }} />
        ))}
      </g>
    </svg>
  );
}
