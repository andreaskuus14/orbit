"use client";
import { useCallback, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";

type Win = { calls: number; tokens: number; cost: number; byPurpose: Record<string, { calls: number; tokens: number }> };
type Youtube = { day: string; budget: number; used: number; callers: Record<string, { units: number; searches: number; dataUnits: number; analytics: number }>; shares: Record<string, { left: number }>; note: string };
type View = { youtube?: Youtube; h5: Win; d7: Win; level: { pct: number; heavy: boolean }; settings: { calls5h: number; tokens5h: number; warnPct: number }; limit: { until: number } | null; hold: string };

/** ANALYTICS: Claude (Max plan) usage over the rolling 5-hour and 7-day windows, by purpose, with the owner's own budget. */
export function UsageMeter() {
  const [v, setV] = useState<View | null>(null);
  const [form, setForm] = useState({ calls5h: "", tokens5h: "", warnPct: "" });
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/usage-meter").then((x) => (x.ok ? x.json() : null)).catch(() => null) as View | null;
    if (!r) return setMsg("Could not load the usage meter");
    setV(r);
    setForm((f) => (f.calls5h ? f : { calls5h: String(r.settings.calls5h), tokens5h: String(r.settings.tokens5h), warnPct: String(r.settings.warnPct) }));
  }, []);
  const poll = useCallback(() => void load(), [load]);
  usePoll(poll, pollMs(30_000));

  async function save(extra: Record<string, unknown> = {}) {
    setMsg("");
    const r = await fetch("/api/usage-meter", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calls5h: Number(form.calls5h), tokens5h: Number(form.tokens5h), warnPct: Number(form.warnPct), ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error || "Couldn't save");
    setV(j); setMsg("Saved");
  }

  if (!v) return msg ? <p className="error">{msg}</p> : null;
  const pct = Math.min(100, v.level.pct), color = v.limit ? "var(--rose)" : v.level.heavy ? "var(--amber)" : "var(--mint)";
  const purposes = Object.entries(v.h5.byPurpose).sort((a, b) => b[1].calls - a[1].calls);
  return (
    <section className="space-y-2" aria-label="Claude usage meter">
      <h3 className="h3">Claude usage (Max plan)</h3>
      <div className="card space-y-1.5">
        <div className="flex justify-between text-sm"><span>Last 5 hours</span><b style={{ color }}>{v.h5.calls} / {v.settings.calls5h} calls · {v.level.pct}%</b></div>
        <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share of your 5-hour budget used"
          style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color }} />
        </div>
        <div className="muted text-xs">{v.h5.tokens.toLocaleString()} tokens{v.h5.cost ? ` · ≈$${v.h5.cost.toFixed(2)} API-equivalent` : ""} · 7 days: {v.d7.calls} calls, {v.d7.tokens.toLocaleString()} tokens</div>
        {v.hold && <p className="text-sm" style={{ color }} role="status">{v.hold}. Background work (autopilot, goals, suggestions, translations) waits; CORE chat is never blocked.</p>}
        {purposes.length > 0 && <ul className="text-xs">{purposes.map(([k, p]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="muted">{p.calls} calls · {p.tokens.toLocaleString()} tok</span></li>)}</ul>}
      </div>
      {v.youtube && <details className="card text-sm" aria-label="YouTube quota usage">
        <summary className="cursor-pointer">YouTube · {Math.max(0, v.youtube.budget - v.youtube.used)} / {v.youtube.budget} budget units left · {v.youtube.day} (Pacific)</summary>
        <p className="muted mt-1 text-xs">{v.youtube.note}</p>
        <ul className="mt-1 text-xs">{Object.entries(v.youtube.callers).sort((a, b) => b[1].units - a[1].units).map(([name, c]) => <li key={name}>{name}: {c.units} weighted units · {c.searches} searches · {c.dataUnits} other Data API units · {c.analytics} Analytics reports</li>)}</ul>
        <p className="muted mt-1 text-xs">Shares left: {Object.entries(v.youtube.shares).map(([name, s]) => `${name}: ${s.left}`).join(" · ")}. Manual reserve: 20%. Resets at midnight Pacific.</p>
      </details>}
      <details className="text-sm">
        <summary className="muted cursor-pointer">Budget & warning</summary>
        <p className="muted text-xs mt-1">Anthropic doesn&apos;t publish exact Max limits (they&apos;re rolling 5-hour and weekly windows), so set your own 5-hour budget. The default of 150 calls is a cautious guess: raise it if you never hit limits, lower it if you do.</p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <label className="text-xs">Calls / 5 h<input className="field block w-24" type="number" min={5} max={10000} value={form.calls5h} onChange={(e) => setForm({ ...form, calls5h: e.target.value })} /></label>
          <label className="text-xs">Tokens / 5 h (0 = off)<input className="field block w-32" type="number" min={0} value={form.tokens5h} onChange={(e) => setForm({ ...form, tokens5h: e.target.value })} /></label>
          <label className="text-xs">Warn at %<input className="field block w-20" type="number" min={10} max={100} value={form.warnPct} onChange={(e) => setForm({ ...form, warnPct: e.target.value })} /></label>
          <button className="chip" onClick={() => save()}>Save</button>
          {v.limit && <button className="chip" onClick={() => save({ clearLimit: true })} title="The limit has reset: let background work run again">Limit has reset</button>}
        </div>
        {msg && <p className="muted text-xs" role="status">{msg}</p>}
      </details>
    </section>
  );
}
