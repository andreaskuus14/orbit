"use client";
import { useEffect, useState } from "react";
import type { StatsResult } from "@/lib/agent-stats-pure";

// One agent's last-30-days performance card. Data: /api/agents/stats, shared by every card for 30 s.

let cache: { at: number; p: Promise<StatsResult> } | null = null;
function loadStats(): Promise<StatsResult> {
  if (cache && Date.now() - cache.at < 30_000) return cache.p;
  const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const p = fetch(`/api/agents/stats?tz=${tz}`, { cache: "no-store" }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j as StatsResult;
  });
  cache = { at: Date.now(), p };
  p.catch(() => { if (cache?.p === p) cache = null; }); // don't keep a failure for 30 s
  return p;
}

const dur = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`;

export function AgentStatsCard({ agent }: { agent: string }) {
  const [d, setD] = useState<StatsResult | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { loadStats().then(setD, (e: Error) => setErr(e.message)); }, [agent]);

  if (err) return <div className="card text-xs"><p className="error" role="alert">{err}</p></div>;
  if (!d) return <div className="card h-24 animate-pulse text-xs" role="status" aria-label="Loading stats"><span className="sr-only">Loading…</span></div>;
  const s = d.agents[agent] ?? { done: 0, failed: 0, running: 0, awaiting: 0, avgMs: null, last7: [0, 0, 0, 0, 0, 0, 0], savedMin: 0 };
  const finished = s.done + s.failed;
  const max = Math.max(1, ...s.last7);
  const week = s.last7.reduce((a, b) => a + b, 0);
  return (
    <div className="card space-y-2 text-xs" aria-label={`${agent} stats, last 30 days`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="muted">LAST 30 DAYS</span>
        {d.star === agent && <span className="pill ok">⭐ Employee of the week</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        <div><div className="text-base">{s.done}</div><div className="muted">done</div></div>
        <div><div className="text-base">{s.failed}</div><div className="muted">failed</div></div>
        <div><div className="text-base">{finished ? `${Math.round((s.done / finished) * 100)}%` : "—"}</div><div className="muted">success</div></div>
        <div><div className="text-base">{s.avgMs == null ? "—" : dur(s.avgMs)}</div><div className="muted">avg time</div></div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <svg viewBox="0 0 70 24" width="105" height="36" role="img" aria-label={`Tasks done per day, last 7 days: ${s.last7.join(", ")} (${week} total)`}>
          {s.last7.map((n, i) => {
            const h = n ? Math.max(2, (n / max) * 22) : 1;
            return <rect key={i} x={i * 10 + 1} y={24 - h} width="8" height={h} rx="1.5" fill="currentColor" opacity={n ? 0.85 : 0.25} className="text-cyan-300" />;
          })}
        </svg>
        <span className="muted">≈ {s.savedMin.toLocaleString()} min saved</span>
      </div>
    </div>
  );
}
