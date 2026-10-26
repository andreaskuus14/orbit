"use client";
// ARCH floor-plan generator panel (roadmap 3): a brief → 3–5 layout options from the pure solver; picking one replaces the
// model, so the 3D view, sun study, walk and costs work on it. No model calls.
import { useMemo, useState } from "react";
import { generatePlans, parseBrief, planScene, STARTER_BRIEF, type PlanOption } from "@/lib/arch-plan-pure";
import type { Scene } from "@/lib/arch-pure";

const HUES = ["#c9a227", "#5b8def", "#d9663b", "#4caf7a", "#a066c9", "#3bb3b3", "#c95b8d", "#8d9c3b"];

/** Top-down sketch of one floor: north (−Z) up, room names, met wishes shown as a door tick. */
function PlanSvg({ o, f, names }: { o: PlanOption; f: number; names: string[] }) {
  const k = 120 / Math.max(o.w, o.d), fl = o.floors[f];
  return (
    <svg width={o.w * k + 4} height={o.d * k + 4} viewBox={`${-o.w / 2 - 0.2} ${-o.d / 2 - 0.2} ${o.w + 0.4} ${o.d + 0.4}`} role="img" aria-label={`Floor ${f + 1} plan`}>
      {fl.rooms.map(({ i, r }) => <g key={i}>
        <rect x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} fill={HUES[i % HUES.length]} fillOpacity={0.25} stroke="currentColor" strokeWidth={0.08} />
        <text x={(r.x0 + r.x1) / 2} y={(r.z0 + r.z1) / 2} fontSize={Math.min(0.9, (r.x1 - r.x0) / Math.max(4, names[i].length * 0.55))} textAnchor="middle" dominantBaseline="middle" fill="currentColor">{names[i]}</text>
      </g>)}
    </svg>
  );
}

export function ArchPlans({ plot, onPick }: { plot: { w: number; d: number }; onPick: (s: Scene) => void }) {
  const [rooms, setRooms] = useState(STARTER_BRIEF.rooms), [adj, setAdj] = useState(STARTER_BRIEF.adj);
  const [pw, setPw] = useState(plot.w), [pd, setPd] = useState(plot.d), [floors, setFloors] = useState(1), [seed, setSeed] = useState(1);
  const [opts, setOpts] = useState<PlanOption[] | null>(null);
  const brief = useMemo(() => parseBrief(rooms, adj, { w: pw, d: pd }, floors), [rooms, adj, pw, pd, floors]);
  const names = brief.rooms.map((r) => r.name);
  const num = (label: string, v: number, set: (n: number) => void, min: number, max: number) => (
    <label className="flex items-center gap-1 text-xs">{label}<input className="field w-14" type="number" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} /></label>);

  return (
    <div className="card space-y-1.5" aria-label="Floor-plan generator">
      <div className="muted text-[10px] uppercase tracking-widest">Floor plans · from a brief</div>
      <div className="flex flex-wrap gap-2">{num("Plot W", pw, setPw, 5, 200)}{num("D", pd, setPd, 5, 200)}{num("Floors", floors, setFloors, 1, 3)}</div>
      <label className="block text-xs">Rooms, one per line: name, m², optional @floor
        <textarea className="field w-full font-mono text-xs" rows={5} value={rooms} onChange={(e) => setRooms(e.target.value)} /></label>
      <label className="block text-xs">Next to each other: "A - B" (B can be "outside")
        <textarea className="field w-full font-mono text-xs" rows={4} value={adj} onChange={(e) => setAdj(e.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className="chip" disabled={!brief.rooms.length} onClick={() => setOpts(generatePlans(brief, seed))}>Generate options</button>
        {opts && <button className="chip" onClick={() => { const s = seed + 1; setSeed(s); setOpts(generatePlans(brief, s)); }} title="Different starting points">↻ Other options</button>}
        <span className="muted text-[11px]">{brief.rooms.length} rooms, {brief.rooms.reduce((s, r) => s + r.area, 0)} m², {brief.adj.length} wishes</span>
      </div>
      {opts?.map((o, n) => (
        <div key={n} className="space-y-1 border-t border-current/10 pt-1.5">
          <div className="flex items-center justify-between text-xs"><b>Option {n + 1} · {o.score} pts</b><span className="muted num">{o.w} × {o.d} m</span></div>
          <div className="flex flex-wrap gap-2">{o.floors.map((_, f) => <PlanSvg key={f} o={o} f={f} names={names} />)}</div>
          <p className="muted text-[11px]">Area error {Math.round(o.parts.areaErr * 100)}% · wishes met {o.parts.adjMet}/{o.parts.adjTotal} · corridor {o.parts.corridorPct}% · daylight {Math.round(o.parts.daylight * 100)}% of rooms{o.parts.thin ? ` · ${o.parts.thin} narrow room${o.parts.thin === 1 ? "" : "s"}` : ""}</p>
          <button className="chip" onClick={() => onPick(planScene(brief, o))}>Use this plan</button>
        </div>))}
      {opts && !opts.length && <p className="muted text-xs">Add at least one room.</p>}
      <p className="muted text-[11px]">Rectangles to wall centre lines, north up. No stairs are added: list them as a room. A study sketch, not a design.</p>
    </div>
  );
}
