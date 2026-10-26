"use client";
import { useEffect, useState } from "react";
import { hintText, type Score } from "@/lib/predict-pure";
import { AREA_INFO, type Area } from "@/lib/autonomy-pure";

// Approval predictions (C4) in the UI: the subtle hint on approval cards, the ANALYTICS score and the autonomy suggestion.
// One shared fetch of /api/predictions per minute for every card on screen.
type View = { open: Record<string, { p: number; why: string }>; week: Score; month: Score; eligible: { area: string; label: string; autonomy: string; hits: number; n: number }[] };
let cache: { at: number; p: Promise<View | null> } | null = null;
const get = () => {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), p: fetch("/api/predictions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) };
  return cache.p;
};
function usePredictions() {
  const [v, setV] = useState<View | null>(null);
  useEffect(() => { let on = true; void get().then((x) => on && setV(x)); return () => { on = false; }; }, []);
  return v;
}

/** "ORBIT thinks: approve, 87%" under an item waiting for his decision; nothing when ORBIT has no guess. id: predict.ts item id. */
export function OrbitThinks({ id }: { id: string }) {
  const x = usePredictions()?.open[id];
  return x ? <span className="muted text-[11px]" title={`Why: ${x.why}. A guess from your past decisions; you decide.`}>{hintText(x)}</span> : null;
}

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)}%`);

/** ANALYTICS: how well ORBIT guessed his decisions (hit rate, Brier score, calibration). */
export function PredictionScore() {
  const v = usePredictions();
  const [days, setDays] = useState<7 | 30>(7);
  if (!v) return null;
  const s = days === 7 ? v.week : v.month;
  return (
    <section className="space-y-2" aria-label="Prediction accuracy">
      <h3 className="h3">Predictions</h3>
      <div className="card space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>{s.n ? `${s.hits} of ${s.n} decisions guessed right` : `No decided guesses in the last ${days} days`}</span>
          <span className="flex gap-1" role="group" aria-label="Prediction period">{([7, 30] as const).map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</span>
        </div>
        {s.n > 0 && <>
          <p className="text-sm"><b>{pct(s.hitRate)}</b> hit rate · Brier <b>{s.brier?.toFixed(3)}</b> <span className="muted text-xs">(0 is perfect, 0.25 a coin flip)</span></p>
          <table className="w-full text-xs" aria-label="Hit rate and Brier score per area">
            <thead><tr><th className="text-left">Area</th><th className="text-right">Guesses</th><th className="text-right">Hit rate</th><th className="text-right">Brier</th></tr></thead>
            <tbody>{s.areas.map((a) => <tr key={a.area}><td>{a.label}</td><td className="text-right num">{a.n}</td><td className="text-right num">{pct(a.hitRate)}</td><td className="text-right num">{a.brier?.toFixed(3)}</td></tr>)}</tbody>
          </table>
          <table className="w-full text-xs" aria-label="Calibration: when ORBIT says X% approve, how often you approved">
            <thead><tr><th className="text-left">ORBIT said approve</th><th className="text-right">Guesses</th><th className="text-right">You approved</th></tr></thead>
            <tbody>{s.bins.filter((b) => b.n).map((b) => <tr key={b.from}><td>{pct(b.from)}–{pct(b.to)} <span className="muted">(avg {pct(b.meanP)})</span></td><td className="text-right num">{b.n}</td><td className="text-right num">{pct(b.rate)}</td></tr>)}</tbody>
          </table>
        </>}
        <p className="muted text-xs">ORBIT guesses each clip, proposal, draft, memory suggestion, niche and deal before you decide, from your own past decisions (recent ones count more), and is scored once you do.</p>
      </div>
    </section>
  );
}

/** Profile → Autonomy: areas ORBIT has predicted ≥90% right over his last 30 decisions. A suggestion only; nothing changes by itself. */
export function PredictionEligible() {
  const e = usePredictions()?.eligible ?? [];
  return e.length ? (
    <ul className="space-y-1 text-xs" aria-label="Do & report suggestions">
      {e.map((x) => <li key={x.area} className="muted">Suggestion: {x.label}: ORBIT guessed {x.hits} of your last {x.n} decisions right. “{AREA_INFO[x.autonomy as Area]?.label ?? x.autonomy}” may be eligible for Do & report; only you can change it.</li>)}
    </ul>
  ) : null;
}
