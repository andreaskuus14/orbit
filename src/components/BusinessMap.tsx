"use client";
// BUSINESS pipeline map (the planet's "advanced" layer): one ring per stage (outer = to contact, inner = paying), one dot per
// business from business-map-pure. A follow-up that's due gets an amber ring. Every dot is a real button: Tab/arrows move,
// Enter opens the client. Plain SVG: no WebGL, nothing animates unless motion is allowed (CSS, transform/opacity only).
import { useRef, useState, type KeyboardEvent } from "react";
import { STAGES } from "@/lib/business-pure";
import { STAGE_COLOR, STAGE_RADIUS, type MapNode } from "@/lib/business-map-pure";

const R = 3.3, SIZE = 260;
const px = (v: number) => (v / R) * (SIZE / 2) + SIZE / 2;

export default function BusinessMap({ nodes, onPick, label, stageName, dueText }: {
  nodes: MapNode[]; onPick: (id: string) => void; label: string; stageName: (s: string) => string; dueText: string;
}) {
  const [focus, setFocus] = useState(0);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const k = e.key, n = nodes.length;
    const next = k === "ArrowRight" || k === "ArrowDown" ? (i + 1) % n : k === "ArrowLeft" || k === "ArrowUp" ? (i - 1 + n) % n : k === "Home" ? 0 : k === "End" ? n - 1 : -1;
    if (next >= 0) { e.preventDefault(); setFocus(next); refs.current[next]?.focus(); }
    else if (k === "Enter" || k === " ") { e.preventDefault(); onPick(nodes[i].id); }
  };
  const [hover, setHover] = useState<MapNode | null>(null);
  const shown = hover ?? null;
  return (
    <figure className="biz-map">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={label}>
        {STAGES.filter((s) => s !== "lost").map((s) => <circle key={s} cx={SIZE / 2} cy={SIZE / 2} r={px(STAGE_RADIUS[s]) - SIZE / 2} className="biz-ring" style={{ stroke: STAGE_COLOR[s] }} />)}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={5} className="biz-core" />
        {nodes.map((n, i) => (
          <g key={n.id} ref={(el) => { refs.current[i] = el; }} role="button" tabIndex={i === focus ? 0 : -1} className="biz-node" data-due={n.due || undefined} data-lost={n.stage === "lost" || undefined}
            aria-label={`${n.name}, ${stageName(n.stage)}${n.due ? `, ${dueText}` : ""}`} transform={`translate(${px(n.x).toFixed(1)} ${px(n.z).toFixed(1)})`}
            onClick={() => onPick(n.id)} onKeyDown={(e) => move(e, i)} onFocus={() => { setFocus(i); setHover(n); }} onBlur={() => setHover(null)}
            onPointerEnter={() => setHover(n)} onPointerLeave={() => setHover(null)}>
            <circle r={12} className="biz-hit" />
            {n.due && <circle r={8} className="biz-due" />}
            <circle r={n.stage === "lost" ? 3.5 : 5} style={{ fill: n.color }} />
          </g>
        ))}
      </svg>
      <figcaption className="biz-map-tip" aria-hidden="true">{shown ? `${shown.name} · ${stageName(shown.stage)}${shown.due ? ` · ${dueText}` : ""}` : " "}</figcaption>
    </figure>
  );
}
