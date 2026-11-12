"use client";
import { useEffect, useState } from "react";
import { MAX_CONTEXT, PERSONAS, STAGES, STAGE_LABEL, funnel, heat, personaPlan, type Proposal } from "@/lib/personas-pure";
import { pickGame } from "@/lib/persona-calibration-pure";
import { importDrafts } from "@/lib/backlog-pure";
import type { DevWorld as World } from "@/lib/devworld-pure";
import type { Calibration, PersonaReport } from "@/lib/personas";
import { PINK } from "./RobloxBuild";
import PersonaCalibration from "./PersonaCalibration";

type View = { context: string; report: PersonaReport | null; calibration: Calibration | null; running: boolean };
const HEAT = ["transparent", "rgba(251,191,36,0.25)", "rgba(249,115,22,0.45)", "rgba(244,63,94,0.7)"];

async function api(body?: unknown): Promise<View> {
  const res = await fetch("/api/personas", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
  return j as View;
}

/** GAME DEV → Personas: 20 simulated player types vs the pet sim. Shows what was measured in Studio apart from what the model simulated. */
export default function PersonaPlaytest({ world, commit, gameId }: { world: World | null; commit: (w: World) => boolean; gameId: string | null }) {
  const [v, setV] = useState<View | null>(null);
  const [ctx, setCtx] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [plan, setPlan] = useState("");

  useEffect(() => { api().then((x) => { setV(x); setCtx(x.context); }, (e) => setErr(e instanceof Error ? e.message : String(e))); }, []);
  const act = async (what: string, body: unknown) => {
    setBusy(what); setErr("");
    try { setV(await api(body)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };

  const r = v?.report;
  const games = world?.games ?? [];
  const target = pickGame(games, gameId)?.id ?? "";
  const add = (p: Proposal) => {
    if (!world || !target) return;
    const out = importDrafts(world, target, [{ title: p.title, detail: p.detail, kind: p.kind, priority: p.priority, severity: p.severity, status: "open" }], new Date().toISOString(), () => crypto.randomUUID());
    if (!out.added) { setAdded((a) => [...a, p.title]); setErr(`"${p.title}" is already in the backlog (or it is full).`); return; }
    if (commit(out.world)) setAdded((a) => [...a, p.title]);
  };
  const f = r ? funnel(r.results) : [];
  const measuredRuns = r?.measured.filter((m) => m.done).length ?? 0;

  return (
    <section className="glass rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Persona playtest">
      <h3 className="brand mb-1 text-sm" style={{ color: PINK }}>Persona playtest</h3>
      <p className="muted text-xs">20 player types (new player, impatient kid, collector, grinder, spender…) play your pet sim each night. <b>Measured</b> = a real look-only
        Studio run (spawn, walk, look, console); the bridge can&apos;t click, press keys or run code. <b>Simulated</b> = a model walkthrough of your game notes, bugs,
        pasted UI text and Studio log, scored by each persona&apos;s patience. Treat simulated results as hypotheses, not player data.</p>

      <div aria-live="polite" className="mt-2 grid gap-3">
        {!r ? <p className="muted text-xs">{v ? "No persona playtest yet. It runs in the night shift, or run a simulated one now." : "Loading…"}</p> : (
          <>
            <p className="text-xs"><b>{r.game}</b> · {new Date(r.at).toLocaleString()} · <span style={{ color: measuredRuns ? "var(--mint)" : undefined }}>{measuredRuns} measured Studio run{measuredRuns === 1 ? "" : "s"}</span>
              <span className="muted"> · {r.studio}</span></p>

            <div aria-label="Funnel">
              <b className="text-xs">Funnel (simulated{measuredRuns ? ", join step informed by real Studio runs" : ""})</b>
              {f.map((s) => (
                <div key={s.stage} className="mt-1 flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0">{STAGE_LABEL[s.stage]}</span>
                  <span className="h-3 rounded" style={{ width: `${(s.reached / r.results.length) * 60}%`, minWidth: 2, background: PINK }} />
                  <span>{s.reached}/{r.results.length}</span>
                  {s.quit > 0 && <span className="muted">−{s.quit} quit before it</span>}
                </div>
              ))}
            </div>

            <div className="overflow-x-auto" aria-label="Friction heatmap">
              <b className="text-xs">Where it hurts (friction vs patience; ✕ = quit there)</b>
              <table className="mt-1 w-full text-[11px]">
                <thead><tr><th className="text-left">Persona</th>{STAGES.map((s) => <th key={s}>{STAGE_LABEL[s]}</th>)}</tr></thead>
                <tbody>
                  {r.results.map((x) => {
                    const p = PERSONAS.find((q) => q.id === x.persona);
                    return (
                      <tr key={x.persona} title={x.quitAt ? `Quit before ${STAGE_LABEL[x.quitAt].toLowerCase()}: ${x.why}` : x.why}>
                        <td className="whitespace-nowrap">{p ? `${p.name} · ${p.type}` : x.persona}</td>
                        {STAGES.map((s) => {
                          const past = x.quitAt && STAGES.indexOf(s) > STAGES.indexOf(x.quitAt);
                          return <td key={s} className="text-center" style={{ background: past ? "transparent" : HEAT[heat(x.cost[s], p?.patience ?? 5)] }}>
                            {x.quitAt === s ? "✕" : past ? "" : x.cost[s] || ""}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PersonaCalibration results={r.results} real={world?.retention?.find((x) => x.game === target)} saved={v?.calibration ?? null} busy={!!busy} onSave={() => act("cal", { action: "calibrate", gameId: target })} />

            <details>
              <summary className="text-xs cursor-pointer">Why each persona quit</summary>
              <ul className="mt-1 grid gap-0.5 text-xs">
                {r.results.map((x) => { const p = PERSONAS.find((q) => q.id === x.persona); return (
                  <li key={x.persona}><b>{p?.name ?? x.persona}</b> ({p?.type}): {x.quitAt ? `quit before ${STAGE_LABEL[x.quitAt].toLowerCase()}, ${x.why}` : x.why}
                    <span className="muted"> · {x.source}</span></li>); })}
              </ul>
            </details>

            {r.proposals.length > 0 && (
              <div>
                <b className="text-xs">Backlog proposals</b> <span className="muted text-xs">(nothing is added until you click)</span>
                <ul className="mt-1 grid gap-1">
                  {r.proposals.map((p) => (
                    <li key={p.title} className="rounded-md border p-1 text-xs" style={{ borderColor: `${PINK}33` }}>
                      <div className="flex items-start gap-2">
                        <span><b>{p.title}</b> <span className="muted">· {p.kind} · {p.priority} · {p.source}</span></span>
                        <button className="chip ml-auto shrink-0" onClick={() => add(p)} disabled={!world || !target || added.includes(p.title)} aria-label={`Add ${p.title} to the backlog`}>
                          {added.includes(p.title) ? "Added" : "Add to backlog"}</button>
                      </div>
                      <p className="muted mt-0.5">{p.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.walk.notes && <p className="muted text-xs">Walkthrough: {r.walk.notes}</p>}
          </>
        )}

        <details>
          <summary className="text-xs cursor-pointer">Persona plans (what is measured vs simulated)</summary>
          <select className="field mt-1 py-1 text-xs" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Persona">
            <option value="">Pick a persona…</option>
            {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.type} (patience {p.patience}, reads {["", "little", "some", "everything"][p.reading]})</option>)}
          </select>
          {plan && <ol className="mt-1 grid gap-0.5 text-xs">{personaPlan(PERSONAS.find((p) => p.id === plan)!).map((s) => (
            <li key={s.stage}><b>{STAGE_LABEL[s.stage]}</b> <span style={{ color: s.how === "measured" ? "var(--mint)" : undefined }}>[{s.how}]</span> {s.action}</li>))}</ol>}
        </details>

        <label className="grid gap-1 text-xs">Your game&apos;s UI text and key scripts (optional, makes the simulation much better; the bridge can&apos;t read StarterGui)
          <textarea className="field min-h-[5rem] w-full font-mono text-[11px]" maxLength={MAX_CONTEXT} value={ctx} onChange={(e) => setCtx(e.target.value)} disabled={!!busy}
            placeholder="Paste button labels, tutorial text, egg prices, upgrade costs, or script excerpts…" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="chip" onClick={() => act("save", { action: "context", context: ctx })} disabled={!!busy || ctx === (v?.context ?? "")}>{busy === "save" ? "Saving…" : "Save text"}</button>
          <button className="btn" style={{ background: `linear-gradient(90deg, ${PINK}, #db2777)` }} onClick={() => act("run", { action: "run", gameId: target })} disabled={!!busy || v?.running}>
            {busy === "run" ? "Simulating (about a minute)…" : v?.running ? "Running…" : "Run simulated playtest now"}</button>
        </div>
        <p className="muted text-[11px]">Real Studio runs (two personas a night) only happen in the night shift, with Studio open on your PC.</p>
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </section>
  );
}
