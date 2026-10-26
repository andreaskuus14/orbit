"use client";
import { useEffect, useRef, useState } from "react";
import type { Margin } from "@/lib/niche-pure";
import { eur, fixScenario, fmt, histogram, KEYS, scenarioFrom, simulate, SPEC, takeaways, type Key, type Result, type Scenario } from "@/lib/whatif-pure";

// BUSINESS what-if simulator (roadmap 3): drag ranges, 10k seeded Monte Carlo months in a worker, histogram + tornado + plain-English takeaways.
const SEED = 42, BINS = 24;
type Sim = { run: (s: Scenario) => Promise<Result>; stop: () => void };

function makeSim(): Sim {
  if (typeof Worker === "undefined") return { run: async (s) => simulate(s, SEED), stop: () => {} };
  const w = new Worker(new URL("./whatif.worker.ts", import.meta.url), { type: "module" });
  let seq = 0;
  const wait = new Map<number, { ok: (r: Result) => void; no: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent<{ id: number; result?: Result; error?: string }>) => {
    const p = wait.get(e.data.id); wait.delete(e.data.id);
    if (e.data.result) p?.ok(e.data.result); else p?.no(new Error(e.data.error));
  };
  return {
    run: (scenario) => new Promise((ok, no) => { const id = ++seq; wait.set(id, { ok, no }); w.postMessage({ id, scenario, seed: SEED }); }),
    stop: () => w.terminate(),
  };
}

export default function WhatIf({ margin }: { margin: Margin }) {
  const [scen, setScen] = useState<Scenario[]>(() => [scenarioFrom(margin)]);
  const [res, setRes] = useState<(Result | null)[]>([null]);
  const [err, setErr] = useState("");
  const sim = useRef<Sim | null>(null);
  useEffect(() => { sim.current = makeSim(); return () => sim.current?.stop(); }, []);
  useEffect(() => { // debounce while dragging; only the latest run per change lands
    let live = true;
    const t = setTimeout(() => {
      Promise.all(scen.map((s) => (sim.current ? sim.current.run(fixScenario(s)) : simulate(fixScenario(s), SEED))))
        .then((r) => { if (live) { setRes(r); setErr(""); } }, (e: Error) => live && setErr(e.message));
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [scen]);
  const set = (i: number, s: Scenario) => setScen((xs) => xs.map((x, j) => (j === i ? s : x)));
  const ready = res.filter((r): r is Result => !!r);
  const at = (r: Result, p: number) => r.profits[Math.round(p * (r.profits.length - 1))];
  let lo = Math.min(...ready.map((r) => at(r, 0.01))), hi = Math.max(...ready.map((r) => at(r, 0.99)));
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const hists = res.map((r) => (r ? histogram(r.profits, lo, hi, BINS) : null));
  const top = Math.max(1, ...hists.flatMap((h) => h ?? []));
  return (
    <div className="space-y-2 rounded-md border border-white/10 p-2" aria-label="What-if simulator">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="muted text-xs">10,000 simulated months. Every month picks each input from your range (most often near the middle).</p>
        <button className="chip" aria-pressed={scen.length === 2} onClick={() => { setScen((xs) => (xs.length === 2 ? [xs[0]] : [xs[0], structuredClone(xs[0])])); setRes((r) => [r[0]]); }}>
          {scen.length === 2 ? "Single scenario" : "Compare with B"}</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className={`grid gap-3 ${scen.length === 2 ? "md:grid-cols-2" : ""}`}>
        {scen.map((s, i) => (
          <Panel key={i} name={scen.length === 2 ? (i ? "B" : "A") : ""} s={s} r={res[i] ?? null} h={hists[i] ?? null} lo={lo} hi={hi} top={top} set={(x) => set(i, x)} />
        ))}
      </div>
    </div>
  );
}

function Panel({ name, s, r, h, lo, hi, top, set }: { name: string; s: Scenario; r: Result | null; h: number[] | null; lo: number; hi: number; top: number; set: (s: Scenario) => void }) {
  const W = 240, H = 70, x = (v: number) => ((v - lo) / (hi - lo)) * W, bw = W / BINS;
  const maxSwing = Math.max(1e-9, ...(r?.tornado.map((t) => t.swing) ?? []));
  return (
    <section className="min-w-0 space-y-2" aria-label={name ? `Scenario ${name}` : "Scenario"}>
      {name && <b className="text-xs">Scenario {name}</b>}
      {r && h && <>
        <svg viewBox={`0 0 ${W} ${H + 12}`} className="w-full" role="img"
          aria-label={`Monthly profit: median ${eur(r.p50)}, 5th to 95th percentile ${eur(r.p5)} to ${eur(r.p95)}, ${Math.round(r.pLoss * 100)}% of months lose money`}>
          {h.map((c, b) => {
            const bh = (c / top) * H, left = lo + b * (hi - lo) / BINS;
            return <rect key={b} x={b * bw + 0.5} y={H - bh} width={bw - 1} height={bh} fill={left + (hi - lo) / BINS / 2 < 0 ? "var(--rose)" : "var(--mint)"} opacity={0.8} />;
          })}
          {lo < 0 && hi > 0 && <line x1={x(0)} x2={x(0)} y1={0} y2={H} stroke="var(--ink)" strokeDasharray="2 2" strokeWidth={0.6} />}
          <line x1={x(r.p50)} x2={x(r.p50)} y1={0} y2={H} stroke="var(--cyan)" strokeWidth={1} />
          <text x={0} y={H + 10} fontSize={8} fill="var(--muted)">{eur(lo)}</text>
          <text x={W} y={H + 10} fontSize={8} fill="var(--muted)" textAnchor="end">{eur(hi)}</text>
        </svg>
        <p className="text-xs"><span className="num">{Math.round(r.pLoss * 100)}%</span> loss months · median <b className="num">{eur(r.p50)}</b> · 90% between <span className="num">{eur(r.p5)}</span> and <span className="num">{eur(r.p95)}</span></p>
        <ul className="list-disc space-y-0.5 pl-4 text-xs">{takeaways(fixScenario(s), r).map((t) => <li key={t}>{t}</li>)}</ul>
        <div className="space-y-0.5 text-xs" aria-label="What matters most (profit with one input at its low and high end, others in the middle)">
          <div className="muted">What matters most</div>
          {r.tornado.map((t) => (
            <div key={t.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-2" title={`${SPEC[t.key].label}: ${eur(t.atLo)} at the low end, ${eur(t.atHi)} at the high end`}>
              <span className="truncate muted">{SPEC[t.key].label}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 rounded-sm" style={{ width: `${(t.swing / maxSwing) * 60}%`, background: "var(--cyan)", minWidth: 1 }} />
                <span className="num whitespace-nowrap">{eur(t.swing)}</span></span>
            </div>
          ))}
        </div>
      </>}
      {!r && <p className="muted text-xs">Simulating…</p>}
      <details className="text-xs" open>
        <summary className="cursor-pointer"><b>Ranges</b></summary>
        <div className="space-y-1.5 pt-1">
          {KEYS.map((k) => <RangeRow key={k} k={k} s={s} set={set} />)}
          <label className="flex items-center justify-between gap-2"><span className="muted">Fees (payment + platform) %</span>
            <input className="field w-20" type="number" min={0} max={30} step={0.5} value={Math.round(s.feePct * 1000) / 10} onChange={(e) => set({ ...s, feePct: Number(e.target.value) / 100 })} /></label>
          <label className="flex items-center justify-between gap-2"><span className="muted">Fixed costs / month (shop plan, apps) €</span>
            <input className="field w-20" type="number" min={0} step={5} value={s.fixed} onChange={(e) => set({ ...s, fixed: Number(e.target.value) })} /></label>
        </div>
      </details>
    </section>
  );
}

function RangeRow({ k, s, set }: { k: Key; s: Scenario; set: (s: Scenario) => void }) {
  const { label, step, max } = SPEC[k], m = max(s), r = s[k];
  const put = (end: "lo" | "hi", v: number) => set({ ...s, [k]: end === "lo" ? { lo: v, hi: Math.max(v, r.hi) } : { lo: Math.min(v, r.lo), hi: v } });
  return (
    <div>
      <div className="flex justify-between gap-2"><span className="muted">{label}</span><span className="num">{fmt(k, r.lo)} – {fmt(k, r.hi)}</span></div>
      <div className="flex gap-2">
        <input type="range" className="w-full" min={0} max={m} step={step} value={r.lo} aria-label={`${label}, low end`} onChange={(e) => put("lo", Number(e.target.value))} />
        <input type="range" className="w-full" min={0} max={m} step={step} value={r.hi} aria-label={`${label}, high end`} onChange={(e) => put("hi", Number(e.target.value))} />
      </div>
    </div>
  );
}
