"use client";
// CORE's thinking indicator (Arrival logogram): a circular ink glyph that forms from several points at once, with no
// start and no stroke order, blooms and fades like ink in water. Pure SVG + CSS (globals.css .ink-*): no frame loop.
// Turbulence displacement gives the ink edge; each arc grows outward from its own seed point (dash centred on it).
import { useId, useState } from "react";

const R = 38;
function make() { // a fresh glyph per busy spell: arcs and tendrils at random places on the circle
  const r = Math.random;
  const arcs = Array.from({ length: 6 + Math.floor(r() * 3) }, () => ({ c: 12 + r() * 76, l: 6 + r() * 16, w: 1.2 + r() * 2.4, d: r() * 0.12 }));
  const tendrils = Array.from({ length: 4 }, () => {
    const a = r() * Math.PI * 2, len = 6 + r() * 10, out = r() < 0.5 ? 1 : -1;
    return { x1: Math.cos(a) * R, y1: Math.sin(a) * R, x2: Math.cos(a) * (R + out * len), y2: Math.sin(a) * (R + out * len), d: r() * 0.15 };
  });
  return { arcs, tendrils, seed: Math.floor(r() * 99), rot: Math.floor(r() * 360) };
}

export function InkGlyph({ reduced }: { reduced: boolean }) {
  const id = useId().replace(/:/g, "");
  const [g] = useState(make);
  return (
    <svg aria-hidden className={`ink-glyph${reduced ? " ink-still" : ""}`} viewBox="-60 -60 120 120">
      <filter id={`ink${id}`} x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed={g.seed} />
        <feDisplacementMap in="SourceGraphic" scale="7" />
      </filter>
      <g filter={`url(#ink${id})`} fill="none" stroke="currentColor" strokeLinecap="round">
        {g.arcs.map((a, i) => (
          <circle key={i} className="ink-arc" r={R} pathLength={100} strokeWidth={a.w} transform={`rotate(${g.rot})`}
            style={{ ["--c" as string]: a.c, ["--l" as string]: a.l, animationDelay: `${a.d}s` }} />
        ))}
        {g.tendrils.map((t, i) => (
          <line key={i} className="ink-tendril" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} pathLength={100} strokeWidth={1.1} style={{ animationDelay: `${t.d}s` }} />
        ))}
      </g>
    </svg>
  );
}
