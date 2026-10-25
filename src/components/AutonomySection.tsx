"use client";
import { useCallback, useEffect, useState } from "react";
import { AREAS, AREA_INFO, AUTO_CONFIRM, LEVEL_TEXT, LIMIT_MAX, type Area, type Level, type Levels, type Limits, type Pending } from "@/lib/autonomy-pure";
import { changeStopAll } from "./nav-command";

type View = { levels: Levels; limits: Limits; pending: Pending[]; today: { at: string; area: Area; action: string; ref: string }[]; stopAll: boolean };

/** Profile → Autonomy: per-area level, limits for auto, today's auto actions (ledger), queued ones with Cancel, and Pause all (= Stop-all). */
export function AutonomySection() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [limits, setLimitsDraft] = useState<Limits | null>(null);
  const call = useCallback(async (body?: object) => {
    setErr("");
    const r = await fetch("/api/autonomy", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) { setV(j); setLimitsDraft(j.limits); } else setErr(j?.error ?? "Couldn't load Autonomy");
  }, []);
  useEffect(() => { void call(); const h = setInterval(() => void call(), 30_000); return () => clearInterval(h); }, [call]);

  function pick(area: Area, level: Level) {
    if (level === "auto") {
      const phrase = AUTO_CONFIRM[area]!;
      const typed = prompt(`${AREA_INFO[area].label} → Auto with limits.\n\nORBIT will then act WITHOUT your click (this changes AGENTS.md rule 6 for this area). Limits: ${area === "business-send" ? `${v?.limits.sendPerDay} emails/day, existing prospects only` : `${v?.limits.publishPerDay} Shorts/day`}, nothing with prices, payments, contracts or promises, 10 minutes to cancel, a push after each one, Stop-all pauses it.\n\nType ${phrase} to confirm:`);
      if (typed === null) return;
      return void call({ action: "level", area, level, confirm: typed });
    }
    void call({ action: "level", area, level });
  }
  async function pauseAll() {
    setErr("");
    try { await changeStopAll(true); await call(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't pause"); }
  }

  return (
    <section className="space-y-3" aria-labelledby="autonomy-title">
      <h3 id="autonomy-title" className="text-sm font-semibold">Autonomy</h3>
      <p className="muted text-sm">How much ORBIT may do on its own, per area. The defaults are how ORBIT has always worked: nothing is sent, published or spent without your click.</p>
      <button className="btn w-full py-3 text-base" onClick={() => void pauseAll()} disabled={v?.stopAll} aria-describedby="autonomy-pause">
        {v?.stopAll ? "All autonomy is paused (Stop-all is on)" : "Pause all autonomy"}
      </button>
      <p id="autonomy-pause" className="muted text-xs">Turns on Stop-all: running work stops and queued auto actions are cancelled. Resume from the Stop-all button.</p>
      <dl className="muted space-y-1 text-xs">
        {(["off", "ask", "do", "auto"] as const).map((l) => <div key={l}><dt className="inline font-semibold">{LEVEL_TEXT[l].label}: </dt><dd className="inline">{LEVEL_TEXT[l].means}</dd></div>)}
      </dl>
      {v && (
        <ul className="space-y-2">
          {AREAS.map((a) => (
            <li key={a} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><b>{AREA_INFO[a].label}</b> <span className="muted text-xs">{AREA_INFO[a].what}</span></span>
              <span className="flex gap-1" role="radiogroup" aria-label={AREA_INFO[a].label}>
                {AREA_INFO[a].levels.map((l) => (
                  <button key={l} role="radio" aria-checked={v.levels[a] === l} className={v.levels[a] === l ? "btn" : "chip"} onClick={() => v.levels[a] !== l && pick(a, l)}>
                    {LEVEL_TEXT[l].label}{l === AREA_INFO[a].def ? " (default)" : ""}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {limits && (
        <form className="flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); void call({ action: "limits", ...limits }); }}>
          <label>Auto emails per day<input type="number" min={1} max={LIMIT_MAX.sendPerDay} className="field mt-1 block w-24" value={limits.sendPerDay} onChange={(e) => setLimitsDraft({ ...limits, sendPerDay: Number(e.target.value) })} /></label>
          <label>Auto Shorts per day<input type="number" min={1} max={LIMIT_MAX.publishPerDay} className="field mt-1 block w-24" value={limits.publishPerDay} onChange={(e) => setLimitsDraft({ ...limits, publishPerDay: Number(e.target.value) })} /></label>
          <button className="chip">Save limits</button>
        </form>
      )}
      {!!v?.pending.length && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">Waiting to go out (cancel within 10 min)</h4>
          <ul className="space-y-1">
            {v.pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{p.label} <span className="muted text-xs">at {new Date(p.dueAt).toLocaleTimeString()}</span></span>
                <button className="chip" onClick={() => void call({ action: "cancel", id: p.id })}>Cancel</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold">Today&apos;s auto actions</h4>
        {v?.today.length ? (
          <ul className="space-y-1 text-sm">
            {v.today.map((t, i) => <li key={i}>{new Date(t.at).toLocaleTimeString()}: {t.action === "send" ? "sent an email" : "scheduled a Short"} <span className="muted text-xs">({t.ref})</span></li>)}
          </ul>
        ) : <p className="muted text-xs">None today.</p>}
      </div>
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
