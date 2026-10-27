"use client";
import { useEffect, useState } from "react";
import { MAX_CHANGES, MAX_TABLE, MAX_VOICE, SAMPLE_TABLE, SIM_DEFAULTS, SPENDERS, changesFromSessions, economyPlans, economyReport, fmtMin, parseEconomy, type EconomyReport } from "@/lib/economy-pure";
import type { DevWorld as World } from "@/lib/devworld-pure";
import { PINK } from "./RobloxBuild";

// GAME DEV → Economy: the game dev copilot. Balancer + economy personas run here in the browser (pure, seeded); the notes drafter is one
// fast-model call on his click. Proposals only: nothing is changed in Studio or published to Roblox.
type View = { table: string; voice: string; notesAt: string };
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function post(body: unknown) {
  const res = await fetch("/api/economy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
  return j;
}

export default function GameCopilot({ world, gameId }: { world: World | null; gameId: string | null }) {
  const [saved, setSaved] = useState<View | null>(null);
  const [table, setTable] = useState("");
  const [voice, setVoice] = useState("");
  const [players, setPlayers] = useState(SIM_DEFAULTS.players);
  const [seed, setSeed] = useState(SIM_DEFAULTS.seed);
  const [report, setReport] = useState<EconomyReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [changes, setChanges] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/economy", { cache: "no-store" }).then((r) => r.json()).then((v: View) => { setSaved(v); setTable(v.table || SAMPLE_TABLE); setVoice(v.voice); },
      () => { setTable(SAMPLE_TABLE); setMsg("Couldn't load your saved table; showing the sample."); });
  }, []);

  const game = world?.games.find((g) => g.id === gameId) ?? world?.games.find((g) => g.id === "pet-sim");
  const run = () => {
    const { economy, errors } = parseEconomy(table);
    setErrors(errors);
    setReport(economy.eggs.length && economy.rate > 0 ? economyReport(economy, { ...SIM_DEFAULTS, players, seed }) : null);
  };
  const save = async () => { setBusy("save"); setMsg(""); try { setSaved(await post({ action: "save", table, voice })); } catch (e) { setMsg(err(e)); } finally { setBusy(""); } };
  const fromLog = async () => {
    setBusy("log"); setMsg("");
    try {
      const j = await fetch("/api/devsession", { cache: "no-store" }).then((r) => r.json());
      const c = changesFromSessions(j.sessions ?? [], saved?.notesAt ?? "");
      if (c) setChanges(c); else setMsg(saved?.notesAt ? "No Studio changes recorded since your last notes." : "No Studio changes recorded yet.");
    } catch (e) { setMsg(err(e)); } finally { setBusy(""); }
  };
  const draft = async () => {
    setBusy("notes"); setMsg("");
    try { const j = await post({ action: "notes", game: game?.name ?? "Pet Simulator", changes }); setNotes(j.notes); if (!j.ai) setMsg("The model didn't answer: this is the plain list."); }
    catch (e) { setMsg(err(e)); } finally { setBusy(""); }
  };
  const plans = report ? economyPlans(report) : [];
  const dirty = !!saved && (table !== saved.table || voice !== saved.voice);

  return (
    <section className="glass rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Game dev copilot">
      <h3 className="brand mb-1 text-sm" style={{ color: PINK }}>Economy balancer</h3>
      <p className="muted text-xs">Paste your eggs and pets. {players} simulated players per type (free, small spender, whale) play through them with seed {seed}, so
        the same table always gives the same result. Price changes are proposals: you change them in Studio yourself.</p>
      <label className="mt-2 grid gap-1 text-xs">Economy table
        <textarea className="field min-h-[9rem] w-full font-mono text-[11px]" maxLength={MAX_TABLE} value={table} onChange={(e) => setTable(e.target.value)} spellCheck={false} />
      </label>
      <div className="mt-1 flex flex-wrap items-end gap-2 text-xs">
        <label className="grid">Players<input className="field w-20 py-1" type="number" min={1} max={1000} value={players} onChange={(e) => setPlayers(Number(e.target.value) || 1)} /></label>
        <label className="grid">Seed<input className="field w-20 py-1" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
        <button className="btn" style={{ background: `linear-gradient(90deg, ${PINK}, #db2777)` }} onClick={run}>Simulate</button>
        <button className="chip" onClick={save} disabled={!!busy || !dirty}>{busy === "save" ? "Saving…" : dirty ? "Save table" : "Saved"}</button>
        <button className="chip" onClick={() => setTable(SAMPLE_TABLE)}>Sample</button>
      </div>
      <p className="muted mt-1 text-[11px]">Saved tables also feed the night persona playtest (as simulated evidence).</p>
      {errors.length > 0 && <ul className="error mt-1 text-xs" role="alert">{errors.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>}

      {report && (
        <div aria-live="polite" className="mt-2 grid gap-3">
          <div className="overflow-x-auto">
            <b className="text-xs">Time to each egg (median, 90% by)</b>
            <table className="mt-1 w-full text-[11px]">
              <thead><tr><th className="text-left">Egg</th><th>Price</th>{SPENDERS.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
              <tbody>{report.profiles[0].eggs.map((x, k) => (
                <tr key={x.egg}><td>{x.egg}</td><td className="text-center">{x.price.toLocaleString()}</td>
                  {report.profiles.map((p) => { const e = p.eggs[k]; return <td key={p.id} className="text-center" title={`${e.reached}% reach it; median wait ${fmtMin(e.wait)} after the egg before`}
                    style={{ color: e.reached < 50 ? "var(--rose, #f43f5e)" : undefined }}>{e.reached ? `${fmtMin(e.median)} · ${fmtMin(e.p90)}` : "never"}</td>; })}
                </tr>))}</tbody>
            </table>
          </div>
          <p className="text-xs">{report.inflation}</p>
          {report.findings.length > 0 && <div><b className="text-xs">Grind walls and skipped eggs (free player)</b>
            <ul className="mt-1 grid gap-0.5 text-xs">{report.findings.map((f) => <li key={f.egg}><b>{f.egg}</b> [{f.kind}]: {f.why}</li>)}</ul></div>}
          <div>
            <b className="text-xs">Price proposals</b> <span className="muted text-xs">(rough: the model has no upgrades or rebirths; re-simulate after editing)</span>
            {report.proposals.length ? <ol className="mt-1 grid gap-0.5 text-xs">{report.proposals.map((p) => (
              <li key={p.egg}><b>{p.egg}</b>: {p.from.toLocaleString()} → <b>{p.to.toLocaleString()}</b> <span className="muted">({p.why})</span></li>))}</ol>
              : <p className="muted text-xs">No price stands out. Every egg is reachable within a free player&apos;s patience.</p>}
          </div>

          <div>
            <b className="text-xs">Playtest bot plan: economy personas</b>
            <ul className="mt-1 grid gap-1 text-xs">{plans.map((p) => (
              <li key={p.id} className="rounded-md border p-1" style={{ borderColor: `${PINK}33` }}>
                <b>{p.name}</b> <span className="muted">({p.note}) · simulated</span>
                <ol className="ml-4 list-decimal">{p.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                <p style={{ color: p.quit ? "#fb923c" : "var(--mint)" }}>{p.quit ?? "Finishes every egg."}</p>
                <p className="muted">Look-only Studio check: {p.studioGoal}</p>
              </li>))}</ul>
          </div>
        </div>
      )}

      <h3 className="brand mb-1 mt-4 text-sm" style={{ color: PINK }}>Update notes</h3>
      <p className="muted text-xs">Type what changed (one per line, like <code>+ added Ocean Egg</code>) or pull it from your Studio sessions. One quick model call drafts the notes; you post them yourself.</p>
      <label className="mt-1 grid gap-1 text-xs">Changes
        <textarea className="field min-h-[5rem] w-full font-mono text-[11px]" maxLength={MAX_CHANGES} value={changes} onChange={(e) => setChanges(e.target.value)} placeholder={"+ added Ocean Egg with Shark (epic)\n~ Forest Egg price 2000 → 1500\n- fixed pets not saving"} />
      </label>
      <label className="mt-1 grid gap-1 text-xs">Example of your past notes (the voice to copy, optional, saved with the table)
        <textarea className="field min-h-[3rem] w-full text-[11px]" maxLength={MAX_VOICE} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="🎉 UPDATE 3! 🎉 New egg, new pets…" />
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <button className="chip" onClick={fromLog} disabled={!!busy}>{busy === "log" ? "Reading…" : "From Studio sessions"}</button>
        <button className="btn" style={{ background: `linear-gradient(90deg, ${PINK}, #db2777)` }} onClick={draft} disabled={!!busy || !changes.trim()}>{busy === "notes" ? "Drafting…" : "Draft notes"}</button>
        {notes && <button className="chip" onClick={() => navigator.clipboard?.writeText(notes).then(() => setMsg("Copied."), () => setMsg("Couldn't copy."))}>Copy</button>}
      </div>
      {notes && <textarea className="field mt-1 min-h-[7rem] w-full text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Drafted update notes" />}
      {msg && <p className="muted mt-1 text-xs" role="status">{msg}</p>}
    </section>
  );
}
