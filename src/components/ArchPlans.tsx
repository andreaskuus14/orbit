"use client";
// ARCH floor-plan generator panel (roadmap 3): a brief → 3–5 layout options from the pure solver; picking one replaces the
// model, so the 3D view, sun study, walk and costs work on it. No model calls.
import { useMemo, useState } from "react";
import { generatePlans, withCore, parseBrief, planScene, STARTER_BRIEF, type PlanOption } from "@/lib/arch-plan-pure";
import type { Scene } from "@/lib/arch-pure";
import { useT } from "./i18n";

const HUES = ["#c9a227", "#5b8def", "#d9663b", "#4caf7a", "#a066c9", "#3bb3b3", "#c95b8d", "#8d9c3b"];

/** Top-down sketch of one floor: north (−Z) up, room names, met wishes shown as a door tick. */
function PlanSvg({ o, f, names }: { o: PlanOption; f: number; names: string[] }) {
  const { t } = useT();
  const k = 120 / Math.max(o.w, o.d), fl = o.floors[f];
  return (
    <svg width={o.w * k + 4} height={o.d * k + 4} viewBox={`${-o.w / 2 - 0.2} ${-o.d / 2 - 0.2} ${o.w + 0.4} ${o.d + 0.4}`} role="img" aria-label={t("aplan.floorPlan", { n: f + 1 })}>
      {fl.rooms.map(({ i, r }) => <g key={i}>
        <rect x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} fill={HUES[i % HUES.length]} fillOpacity={0.25} stroke="currentColor" strokeWidth={0.08} />
        <text x={(r.x0 + r.x1) / 2} y={(r.z0 + r.z1) / 2} fontSize={Math.min(0.9, (r.x1 - r.x0) / Math.max(4, names[i].length * 0.55))} textAnchor="middle" dominantBaseline="middle" fill="currentColor">{names[i]}</text>
      </g>)}
    </svg>
  );
}

export function ArchPlans({ plot, onPick }: { plot: { w: number; d: number }; onPick: (s: Scene) => void }) {
  const { t } = useT();
  const [rooms, setRooms] = useState(STARTER_BRIEF.rooms), [adj, setAdj] = useState(STARTER_BRIEF.adj);
  const [pw, setPw] = useState(plot.w), [pd, setPd] = useState(plot.d), [floors, setFloors] = useState(1), [seed, setSeed] = useState(1);
  const [opts, setOpts] = useState<PlanOption[] | null>(null);
  const brief = useMemo(() => parseBrief(rooms, adj, { w: pw, d: pd }, floors), [rooms, adj, pw, pd, floors]);
  const names = withCore(brief).rooms.map((r) => r.name);
  const num = (label: string, v: number, set: (n: number) => void, min: number, max: number) => (
    <label className="flex items-center gap-1 text-xs">{label}<input className="field w-16" type="number" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} /></label>);

  return (
    <div className="card space-y-1.5" aria-label={t("aplan.aria")}>
      <div className="muted text-[12px] font-medium">{t("aplan.head")}</div>
      <div className="flex flex-wrap gap-2">{num(t("aplan.plotW"), pw, setPw, 5, 200)}{num(t("aplan.plotD"), pd, setPd, 5, 200)}{num(t("aplan.floors"), floors, setFloors, 1, 3)}</div>
      <label className="block text-xs">{t("aplan.rooms")}
        <textarea className="field w-full font-mono text-xs" rows={5} value={rooms} onChange={(e) => setRooms(e.target.value)} /></label>
      <label className="block text-xs">{t("aplan.adj")}
        <textarea className="field w-full font-mono text-xs" rows={4} value={adj} onChange={(e) => setAdj(e.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className="chip" disabled={!brief.rooms.length} onClick={() => setOpts(generatePlans(brief, seed))}>{t("aplan.generate")}</button>
        {opts && <button className="chip" onClick={() => { const s = seed + 1; setSeed(s); setOpts(generatePlans(brief, s)); }} title={t("aplan.otherTip")}>↻ {t("aplan.other")}</button>}
        <span className="muted text-[11px]">{t("aplan.summary", { r: brief.rooms.length, a: brief.rooms.reduce((s, r) => s + r.area, 0), w: brief.adj.length })}</span>
      </div>
      {opts?.map((o, n) => (
        <div key={n} className="space-y-1 border-t border-current/10 pt-1.5">
          <div className="flex items-center justify-between text-xs"><b>{t("aplan.option", { n: n + 1, s: o.score })}</b><span className="muted num">{o.w} × {o.d} m</span></div>
          <div className="flex flex-wrap gap-2">{o.floors.map((_, f) => <PlanSvg key={f} o={o} f={f} names={names} />)}</div>
          <p className="muted text-[11px]">{t("aplan.stats", { e: Math.round(o.parts.areaErr * 100), m: o.parts.adjMet, t: o.parts.adjTotal, c: o.parts.corridorPct, d: Math.round(o.parts.daylight * 100) })}{o.parts.thin ? ` · ${t("aplan.thin", { n: o.parts.thin })}` : ""}</p>
          <button className="chip" onClick={() => onPick(planScene(brief, o))}>{t("aplan.use")}</button>
        </div>))}
      {opts && !opts.length && <p className="muted text-xs">{t("aplan.addRoom")}</p>}
      <p className="muted text-[11px]">{t("aplan.note")}</p>
    </div>
  );
}
