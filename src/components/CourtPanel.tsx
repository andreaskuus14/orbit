"use client";
import { useEffect, useRef, useState } from "react";
import { CRITERIA, CRITERION_HINT, DEFAULT_WEIGHTS, MAX_OPTIONS, rescore, splitOptions, type Brief, type CourtResult, type Weights } from "@/lib/court-pure";
import { TWIN_COLOR } from "@/lib/twin-pure";

// GOALS → Courtroom: advocates argue each option from his data, cross-examine each other, a judge scores on his weights.
const JUDGE = "#facc15";
type Cost = { calls: number; maxCalls: number; model: string; used5h: number; budget5h: number; held: string };

export function CourtPanel({ onBack }: { onBack: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [touched, setTouched] = useState(false);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [cost, setCost] = useState<Cost | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<CourtResult | null>(null);
  const [kept, setKept] = useState(false);
  const ac = useRef<AbortController | null>(null);
  const opts = options.map((o) => o.trim()).filter(Boolean);

  useEffect(() => { if (!touched) { const s = splitOptions(question); setOptions(s.length >= 2 ? s : ["", ""]); } }, [question, touched]);
  useEffect(() => {
    let off = false;
    void fetch(`/api/court?options=${Math.max(2, opts.length)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off) setCost(j); }, () => {});
    return () => { off = true; };
  }, [opts.length, busy]);
  useEffect(() => () => ac.current?.abort(), []);

  async function run() {
    ac.current = new AbortController();
    setBusy(true); setErr(""); setRes(null); setKept(false);
    try {
      const r = await fetch("/api/court", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, options: opts, weights }), signal: ac.current.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setRes(j);
    } catch (e) { if (!ac.current?.signal.aborted) setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  async function keep() {
    if (!res) return;
    setErr("");
    const r = await fetch("/api/court", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "keep", id: res.id, weights }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setKept(true); else setErr(j.error || "Could not keep it");
  }

  const live = res?.verdict ? { ...res.verdict, ...rescore(res.verdict.scores, weights) } : null; // sliders re-score without a model call
  const ready = question.trim().length >= 5 && opts.length >= 2 && opts.length <= MAX_OPTIONS && !cost?.held;
  const side = (b: Brief) => res && <Advocate key={b.option} b={b} r={res} total={live?.totals[b.option]} win={live?.winner === b.option} />;

  return (
    <section className="space-y-3 text-sm" aria-labelledby="court-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="court-title" className="font-semibold" style={{ color: JUDGE }}>⚖ Courtroom</h2>
        <button className="chip text-xs" onClick={onBack}>← Goals</button>
      </div>
      <p className="muted text-xs">An advocate per option argues from your memories, niches, goals and calendar (never your journal), they cross-examine each other, and a judge scores on your weights.</p>
      <input className="field w-full" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="Should I launch the candle shop or the poster shop first?" aria-label="Decision" disabled={busy} />
      <div className="flex flex-wrap gap-2">
        {options.map((o, i) => <input key={i} className="field min-w-0 flex-1" value={o} maxLength={120} onChange={(e) => { setTouched(true); setOptions(options.map((x, j) => (j === i ? e.target.value : x))); }} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} disabled={busy} />)}
        {options.length < MAX_OPTIONS && <button className="chip text-xs" onClick={() => { setTouched(true); setOptions([...options, ""]); }} disabled={busy}>+ option</button>}
        {options.length > 2 && <button className="chip text-xs" onClick={() => { setTouched(true); setOptions(options.slice(0, -1)); }} disabled={busy} aria-label="Remove the last option">−</button>}
      </div>
      <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
        <legend className="muted text-xs">What matters (0–5)</legend>
        {CRITERIA.map((c) => (
          <label key={c} className="text-xs" title={CRITERION_HINT[c]}>{c} {weights[c]}
            <input type="range" min={0} max={5} value={weights[c]} className="w-full" onChange={(e) => { const w = { ...weights, [c]: Number(e.target.value) }; if (CRITERIA.some((k) => w[k] > 0)) setWeights(w); }} />
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        {busy ? <button className="chip" onClick={() => ac.current?.abort()}>Stop</button> : <button className="btn" disabled={!ready} onClick={() => void run()}>Run the court</button>}
        {cost && <span className="muted text-xs" aria-live="polite">{cost.held ? `Held: ${cost.held}` : `Costs up to ${Math.min(cost.calls, cost.maxCalls)} ${cost.model} calls · ${cost.used5h}/${cost.budget5h} used in the last 5 h`}</span>}
      </div>
      {busy && <p className="muted" role="status">Advocates are building their cases, then cross-examination, then the judge…</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {res && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-2">{res.briefs.slice(0, 1).map(side)}</div>
            <aside className="card space-y-2" style={{ borderTop: `3px solid ${JUDGE}` }} aria-label="Judge">
              <b style={{ color: JUDGE }}>Judge</b>
              {!live ? <p className="muted">The judge didn&apos;t answer; the cases are below.</p> : (
                <>
                  <p className="font-medium">{live.winner === null ? "Too close to call." : `Verdict: ${res.case.options[live.winner]}`}</p>
                  <p>{live.reason}</p>
                  <p><b>What would change my mind:</b> {live.mindChange}</p>
                  <table className="w-full text-xs">
                    <thead><tr><th className="text-left">score</th>{res.case.options.map((_, i) => <th key={i}>{i + 1}</th>)}</tr></thead>
                    <tbody>{CRITERIA.map((c) => <tr key={c}><td>{c} ×{weights[c]}</td>{live.scores.map((s, i) => <td key={i} className="text-center">{s[c]}</td>)}</tr>)}
                      <tr className="font-medium"><td>total</td>{live.totals.map((t, i) => <td key={i} className="text-center">{t}</td>)}</tr></tbody>
                  </table>
                </>
              )}
              <button className="chip text-xs" disabled={kept} onClick={() => void keep()}>{kept ? "Kept in MEMORY" : "Keep as a decision memory"}</button>
              <p className="muted text-xs">{res.calls} calls · {res.facts} facts from your data</p>
            </aside>
            <div className="space-y-2">{res.briefs.slice(1).map(side)}</div>
          </div>
          <details>
            <summary className="muted cursor-pointer">Transcript</summary>
            <ol className="mt-1 space-y-1">
              {res.briefs.map((b) => <li key={`b${b.option}`}><b>Case for {res.case.options[b.option]}:</b> {b.failed ? "(no answer)" : b.claims.map((k) => k.text).join(" · ")}</li>)}
              {res.attacks.map((a) => <li key={`a${a.by}`} style={{ color: a.failed ? undefined : TWIN_COLOR }}><b>{res.case.options[a.by]} cross-examines {res.case.options[a.target]}:</b> {a.failed ? "(no answer)" : `claim ${a.claim}: ${a.text}`}</li>)}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}

function Advocate({ b, r, total, win }: { b: Brief; r: CourtResult; total?: number; win: boolean }) {
  const hit = r.attacks.find((a) => a.target === b.option && !a.failed);
  return (
    <article className="card space-y-1" style={{ borderTop: `3px solid ${win ? JUDGE : "var(--cyan)"}` }} aria-label={`Advocate for ${r.case.options[b.option]}`}>
      <b>{r.case.options[b.option]}{total !== undefined && <span className="muted"> · {total}/100</span>}</b>
      {b.failed ? <p className="muted">The advocate didn&apos;t answer.</p> : (
        <ol className="list-decimal space-y-1 pl-5">
          {b.claims.map((k, i) => <li key={i} style={hit?.claim === i + 1 ? { textDecoration: "underline dotted", textDecorationColor: TWIN_COLOR } : undefined}>{k.text}{k.evidence.length > 0 && <span className="muted text-xs"> · {k.evidence.join(", ")}</span>}</li>)}
        </ol>
      )}
      {hit && <p className="text-xs" style={{ color: TWIN_COLOR }}>◐ Attacked on claim {hit.claim}: {hit.text}</p>}
    </article>
  );
}
