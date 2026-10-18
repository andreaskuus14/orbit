"use client";
import { useEffect, useRef, useState } from "react";

// DevWorld → The Hive: 6 persona minds brainstorm in parallel, a judge picks the top 3 (src/lib/hive.ts).
const GOLD = "#facc15";
type Idea = { title: string; pitch: string; backers: string[] };
type Result = { top: (Idea & { why: string })[]; ideas: Idea[]; minds: { persona: string; ok: boolean }[]; judged: boolean };

export default function HivePanel() {
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const ac = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => () => ac.current?.abort(), []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (busy || problem.trim().length < 3) return;
    ac.current = new AbortController();
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await fetch("/api/hive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problem }), signal: ac.current.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setRes(j);
    } catch (e) {
      if (!ac.current?.signal.aborted) setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  const failed = res?.minds.filter((m) => !m.ok).length ?? 0;
  return (
    <section className="space-y-3" aria-labelledby="hive-title">
      <h2 id="hive-title" className="text-base font-semibold" style={{ color: GOLD }}>🐝 The Hive</h2>
      <p className="muted text-xs">Six minds (trend hunter, kid player, game designer, YouTuber, contrarian, solo-dev realist) pitch ideas; a judge picks the top 3.</p>
      <form onSubmit={run} className="flex gap-2">
        <input className="field flex-1" value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={300} placeholder="e.g. Roblox game idea for kids" aria-label="Problem to brainstorm" disabled={busy} />
        {busy
          ? <button type="button" className="chip" onClick={() => ac.current?.abort()}>Stop</button>
          : <button type="submit" className="chip" disabled={problem.trim().length < 3}>Brainstorm</button>}
      </form>
      {busy && <p className="muted text-sm" aria-live="polite">{secs < 45 ? "6 minds thinking…" : "Minds done soon, then the judge picks…"} {secs}s</p>}
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {res && (
        <>
          <ol className="space-y-2" aria-label="Top ideas">
            {res.top.map((t, i) => (
              <li key={t.title} className="card space-y-1">
                <div className="font-medium"><span style={{ color: GOLD }}>{i + 1}.</span> {t.title}</div>
                {t.pitch && <p className="text-sm">{t.pitch}</p>}
                <p className="muted text-xs">Why: {t.why} · Backed by {t.backers.join(", ")}</p>
              </li>
            ))}
          </ol>
          <p className="muted text-xs">{res.judged ? "Ranked by the judge." : "Ranked by votes."}{failed ? ` ${failed} of ${res.minds.length} minds didn't answer.` : ""}</p>
          <details>
            <summary className="muted cursor-pointer text-sm">All {res.ideas.length} ideas</summary>
            <ul className="mt-1 space-y-1 text-sm">
              {res.ideas.map((d) => <li key={d.title}><b>{d.title}</b>{d.pitch && ` — ${d.pitch}`} <span className="muted text-xs">({d.backers.join(", ")})</span></li>)}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
