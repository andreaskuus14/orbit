"use client";
import { useEffect, useState } from "react";
import { gameLink, isRbxImage, type TrendSort } from "@/lib/devtools-pure";
import { dueAlerts, type Riser } from "@/lib/trend-rise-pure";
import { notify } from "@/lib/notify-pure";

// DevWorld → Roblox Trend Radar: public Roblox discovery lists + an optional AI read of the patterns.
const PINK = "#f472b6";
type Trends = { source: string; sorts: TrendSort[]; at: number; error?: string; tried: string[]; risers?: Riser[] };
const ALERT_KEY = "orbit.trendAlerts";

/** Bell alert for strong risers, at most once per game per day (fetch-on-view only, no schedule). */
function alertRisers(risers: Riser[]) {
  try {
    const day = new Date().toLocaleDateString("en-CA");
    const { due, next } = dueAlerts(risers, JSON.parse(localStorage.getItem(ALERT_KEY) || "{}"), day);
    for (const r of due) notify({ kind: "studio", title: `🔺 ${r.name} is rising`, body: `+${r.growthPct}% players in ~${r.window}. Make a Short today before it peaks.`, nav: { panel: "creation" } });
    localStorage.setItem(ALERT_KEY, JSON.stringify(next));
  } catch { /* storage blocked: skip alerts */ }
}
const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export default function TrendRadar() {
  const [data, setData] = useState<Trends | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(0);
  const [why, setWhy] = useState<{ text: string; at: number } | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);
  const [whyErr, setWhyErr] = useState("");

  useEffect(() => {
    fetch("/api/devtools?trends=1", { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Couldn't load (${r.status})`); setData(j); alertRisers(j.risers ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);

  async function explain() {
    setWhyBusy(true); setWhyErr("");
    try {
      const r = await fetch("/api/devtools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "why" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setWhy(j);
    } catch (e) { setWhyErr(e instanceof Error ? e.message : "Failed"); } finally { setWhyBusy(false); }
  }

  const sort = data?.sorts[tab];
  const rising = !!data && tab === data.sorts.length;
  return (
    <section className="space-y-3" aria-labelledby="tr-title">
      <h2 id="tr-title" className="text-base font-semibold" style={{ color: PINK }}>📡 Roblox Trend Radar</h2>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {!data && !err && <p className="muted text-sm" aria-live="polite">Checking what&apos;s popular on Roblox…</p>}
      {data && !data.sorts.length && (
        <div className="card space-y-1 text-sm" role="status">
          <p>{data.error}</p>
          <ul className="muted list-disc pl-4 text-xs">{data.tried.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {data && data.sorts.length > 0 && (
        <>
          <p className="muted text-xs">Source: {data.source} · fetched {new Date(data.at).toLocaleTimeString()}{data.tried.length ? ` · (fallback after: ${data.tried.join("; ")})` : ""}</p>
          <div className="flex gap-1.5" role="group" aria-label="List">
            {data.sorts.map((s, i) => <button key={s.id} className="chip" aria-pressed={tab === i} onClick={() => setTab(i)} style={tab === i ? { borderColor: PINK, color: PINK } : undefined}>{s.name}</button>)}
            <button className="chip" aria-pressed={rising} onClick={() => setTab(data.sorts.length)} style={rising ? { borderColor: PINK, color: PINK } : undefined}>🔺 Rising</button>
          </div>
          {rising && (
            <ol className="space-y-1.5">
              {!data.risers?.length && <li className="muted text-sm">No risers yet. ORBIT compares each fetch with ones ~1 h and ~24 h earlier, so check back later.</li>}
              {data.risers?.map((r) => (
                <li key={r.universeId}>
                  <a href={gameLink(r.placeId)} target="_blank" rel="noopener noreferrer" className="card block no-underline" aria-label={`${r.name}, up ${r.growthPct}% in about ${r.window}, opens on Roblox`}>
                    <span className="block truncate text-sm font-semibold">{r.strong ? "🔥 " : ""}{r.name}</span>
                    <span className="muted block text-xs">📈 {r.growthPct >= 0 ? "+" : ""}{r.growthPct}% in ~{r.window}{r.rankJump ? ` · ▲${r.rankJump} places` : ""} · 👥 {num(r.players)}</span>
                    <span className="block text-xs" style={{ color: PINK }}>🎬 Make a Short today, before it peaks.</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
          <ol className="space-y-1.5">
            {sort?.games.map((g, i) => (
              <li key={g.universeId}>
                <a href={gameLink(g.placeId)} target="_blank" rel="noopener noreferrer" className="card flex items-center gap-2.5 no-underline" aria-label={`${i + 1}. ${g.name}, opens on Roblox`}>
                  <span className="muted w-5 shrink-0 text-right text-xs">{i + 1}</span>
                  {isRbxImage(g.icon)
                    ? <img src={g.icon} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg" />
                    : <span className="h-11 w-11 shrink-0 rounded-lg bg-white/5" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{g.name}</span>
                    <span className="muted block text-xs">👥 {num(g.players)} playing · 👍 {g.upvotePct ?? "?"}%{g.genre ? ` · ${g.genre}` : ""}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <button className="btn w-full" onClick={() => void explain()} disabled={whyBusy}>{whyBusy ? "Thinking…" : "✨ Why is it trending?"}</button>
          {whyErr && <p className="error text-sm" role="alert">{whyErr}</p>}
          {why && (
            <div className="card space-y-1 text-sm" aria-live="polite">
              <p className="whitespace-pre-wrap">{why.text}</p>
              <p className="muted text-xs">AI summary of the list only (game names are third-party text) · cached up to 6 h · {new Date(why.at).toLocaleString()}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
