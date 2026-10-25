"use client";
import { useCallback, useEffect, useState } from "react";

type Row = { id: string; title: string; area: string; score: number | null; status: string; reason: string; before: number | null; regressed: boolean };
type View = {
  trend: { month: string; score: number | null }[];
  latest: { month: string; at: string; trigger: string; complete: boolean; calls: number; score: number | null; judged: number; prevMonth: string | null; prevScore: number | null } | null;
  cases: Row[]; worst: Row | null; regressions: string[];
  estimate: { maxCalls: number; lastCalls: number | null }; running: { done: number; total: number } | null;
};
const fmt = (n: number | null) => (n == null ? "–" : n.toFixed(2));

/** ANALYTICS: monthly agent scorecard from 10 recorded cases, judged blind against a 0-2 rubric. */
export function AgentScorecard() {
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/agent-scorecard").then((x) => (x.ok ? x.json() : null)).catch(() => null) as View | null;
    if (r) setV(r); else setMsg("Could not load the agent scorecard");
  }, []);
  useEffect(() => { void load(); const h = setInterval(() => void load(), v?.running ? 10_000 : 60_000); return () => clearInterval(h); }, [load, v?.running]);

  async function start() {
    setMsg("");
    const r = await fetch("/api/agent-scorecard", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error || "Couldn't start");
    setV(j);
  }

  if (!v) return msg ? <p className="error">{msg}</p> : null;
  const l = v.latest, max = 2;
  return (
    <section className="space-y-2" aria-label="Agent scorecard">
      <h3 className="h3">Agent scorecard</h3>
      <div className="card space-y-1.5">
        {l ? <>
          <div className="flex justify-between text-sm">
            <span>{l.month} · {l.judged}/{v.cases.length} cases judged{l.complete ? "" : " (partial)"}</span>
            <b>{fmt(l.score)} / {max}{l.prevScore != null && l.score != null ? <span className="muted"> ({l.score - l.prevScore >= 0 ? "+" : ""}{(l.score - l.prevScore).toFixed(2)} vs {l.prevMonth})</span> : null}</b>
          </div>
          <div className="flex items-end gap-1" style={{ height: 40 }} role="img" aria-label={`Monthly scores: ${v.trend.map((t) => `${t.month} ${fmt(t.score)}`).join(", ")}`}>
            {v.trend.slice(-12).map((t) => <div key={t.month} title={`${t.month}: ${fmt(t.score)}`} style={{ flex: 1, height: `${((t.score ?? 0) / max) * 100}%`, minHeight: 2, background: "var(--mint)", borderRadius: 2, opacity: t.month === l.month ? 1 : 0.5 }} />)}
          </div>
          {v.regressions.length > 0 && <p className="text-sm" style={{ color: "var(--rose)" }} role="status">Regressed vs last month: {v.cases.filter((c) => c.regressed).map((c) => c.title).join(", ")}</p>}
          {v.worst && <p className="text-xs"><b>Worst: {v.worst.title} ({fmt(v.worst.score)})</b> <span className="muted">{v.worst.reason}</span></p>}
          <table className="w-full text-xs" aria-label="Per-case scores">
            <thead><tr><th className="text-left">Case</th><th className="text-right">Last month</th><th className="text-right">Now</th></tr></thead>
            <tbody>{v.cases.map((c) => <tr key={c.id} title={c.reason}>
              <td>{c.title} <span className="muted">· {c.area}</span></td>
              <td className="text-right num muted">{fmt(c.before)}</td>
              <td className="text-right num" style={c.regressed ? { color: "var(--rose)" } : undefined}>{c.score == null ? <span className="muted">{c.status}</span> : fmt(c.score)}{c.regressed ? " ↓" : ""}</td>
            </tr>)}</tbody>
          </table>
        </> : <p className="muted text-sm">No runs yet. It runs once a month on this PC, or start one now.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {v.running ? <span className="text-sm" role="status">Running… {v.running.done}/{v.running.total} cases</span>
            : <button className="chip" onClick={() => void start()}>Run now</button>}
          <span className="muted text-xs">Cost: at most {v.estimate.maxCalls} normal Claude calls per run{v.estimate.lastCalls != null ? ` (last run used ${v.estimate.lastCalls})` : ""}. Waits for Stop-all and usage limits; proposed saves are rejected automatically.</span>
        </div>
        {msg && <p className="muted text-xs" role="status">{msg}</p>}
      </div>
    </section>
  );
}
