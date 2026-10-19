"use client";
import { useEffect, useState } from "react";
import { gameLink, isRbxImage, type TrendSort } from "@/lib/devtools-pure";
import { dueAlerts, type Riser } from "@/lib/trend-rise-pure";
import { notify } from "@/lib/notify-pure";
import type { Topic, YtRiser } from "@/lib/yt-trend-pure";
import { shortsUrl, type Viral } from "@/lib/yt-viral-pure";
import StudyButton from "./StudyButton";
import ReachPanel from "./ReachPanel";

// DevWorld → Roblox Trend Radar: public Roblox discovery lists + an optional AI read of the patterns.
const PINK = "#f472b6";
type Trends = { source: string; sorts: TrendSort[]; at: number; error?: string; tried: string[]; risers?: Riser[]; yt?: { risers: YtRiser[]; topics: Topic[]; region: string; hint?: string; error?: string } };
const ALERT_KEY = "orbit.trendAlerts";
type NicheViral = { videos: Viral[]; queries: string[]; units: number; at: number; hint?: string; error?: string };

/** Bell alert for strong risers, at most once per game per day (fetch-on-view only, no schedule). */
function alertRisers(risers: Riser[], yt: YtRiser[]) {
  try {
    const day = new Date().toLocaleDateString("en-CA");
    const { due, next } = dueAlerts(risers, JSON.parse(localStorage.getItem(ALERT_KEY) || "{}"), day);
    for (const r of due) notify({ kind: "studio", title: `🔺 ${r.name} is rising`, body: `+${r.growthPct}% players in ~${r.window}. Make a Short today before it peaks.`, nav: { panel: "creation" } });
    const y = dueAlerts(yt, next, day, (r) => `yt:${r.id}`);
    for (const r of y.due) notify({ kind: "studio", title: `📺 Rising on YouTube: ${r.title.slice(0, 60)}`, body: `${ytStat(r)} · ${r.channel}. Ride the topic with a Short today.`, nav: { panel: "creation" } });
    localStorage.setItem(ALERT_KEY, JSON.stringify(y.next));
  } catch { /* storage blocked: skip alerts */ }
}
const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const ytStat = (r: YtRiser) => [r.isNew ? `🆕 new on the list at #${r.rank}` : `#${r.rank}`, r.viewsPerHour !== null ? `+${num(r.viewsPerHour)} views/h` : "", r.rankJump ? `▲${r.rankJump} places` : ""].filter(Boolean).join(" · ");

export default function TrendRadar() {
  const [data, setData] = useState<Trends | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(0);
  const [why, setWhy] = useState<{ text: string; at: number } | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);
  const [whyErr, setWhyErr] = useState("");
  const [viral, setViral] = useState<NicheViral | null>(null);
  const [viralErr, setViralErr] = useState("");

  useEffect(() => {
    fetch("/api/devtools?trends=1", { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Couldn't load (${r.status})`); setData(j); alertRisers(j.risers ?? [], j.yt?.risers ?? []); })
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
  useEffect(() => { // search.list costs 100 units: only when the Rising tab is actually opened (server caches 3 h)
    if (!rising || viral || viralErr) return;
    fetch("/api/devtools?viral=1", { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Couldn't load (${r.status})`); setViral(j); })
      .catch((e) => setViralErr(e instanceof Error ? e.message : "Couldn't load"));
  }, [rising, viral, viralErr]);
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
      {data && ( // Roblox down: no list tabs, tab 0 === sorts.length so Rising (YouTube) still shows
        <>
          {data.sorts.length > 0 && <p className="muted text-xs">Source: {data.source} · fetched {new Date(data.at).toLocaleTimeString()}{data.tried.length ? ` · (fallback after: ${data.tried.join("; ")})` : ""}</p>}
          <div className="flex gap-1.5" role="group" aria-label="List">
            {data.sorts.map((s, i) => <button key={s.id} className="chip" aria-pressed={tab === i} onClick={() => setTab(i)} style={tab === i ? { borderColor: PINK, color: PINK } : undefined}>{s.name}</button>)}
            <button className="chip" aria-pressed={rising} onClick={() => setTab(data.sorts.length)} style={rising ? { borderColor: PINK, color: PINK } : undefined}>🔺 Rising</button>
          </div>
          {rising && <h3 className="text-sm font-semibold">🎮 Roblox</h3>}
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
          {rising && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">📺 YouTube <span className="muted text-xs font-normal">Gaming · most popular ({data.yt?.region ?? "US"})</span></h3>
              {data.yt?.hint && <p className="muted text-sm">{data.yt.hint}</p>}
              {data.yt?.error && <p className="error text-sm" role="alert">{data.yt.error}</p>}
              {!!data.yt?.topics.length && (
                <div className="flex flex-wrap gap-1.5" aria-label="Hot topics">
                  <span className="muted text-xs">Hot topics:</span>
                  {data.yt.topics.map((t) => <span key={t.term} className="chip text-xs">{t.term} ×{t.count}</span>)}
                </div>
              )}
              {data.yt && !data.yt.hint && !data.yt.error && !data.yt.risers.length && <p className="muted text-sm">No YouTube risers yet. ORBIT compares each fetch with an earlier one (30 min+), so check back later.</p>}
              <ol className="space-y-1.5">
                {data.yt?.risers.map((r) => (
                  <li key={r.id}>
                    <a href={`https://www.youtube.com/watch?v=${r.id}`} target="_blank" rel="noopener noreferrer" className="card block no-underline" aria-label={`${r.title} by ${r.channel}, ${ytStat(r)}, opens on YouTube`}>
                      <span className="block truncate text-sm font-semibold">{r.strong ? "🔥 " : ""}{r.title}</span>
                      <span className="muted block truncate text-xs">{r.channel} · {ytStat(r)} · 👁 {num(r.views)}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {rising && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">🔥 Blowing up in your niche <span className="muted text-xs font-normal">Shorts from the last 48 h</span></h3>
              {!viral && !viralErr && <p className="muted text-sm" aria-live="polite">Scanning your niche…</p>}
              {viralErr && <p className="error text-sm" role="alert">{viralErr}</p>}
              {viral?.hint && <p className="muted text-sm">{viral.hint}</p>}
              {viral?.error && <p className="error text-sm" role="alert">{viral.error}</p>}
              {viral && !viral.hint && !viral.error && !viral.videos.length && <p className="muted text-sm">No recent Shorts found for these searches.</p>}
              <ol className="space-y-1.5">
                {viral?.videos.map((v) => { const url = shortsUrl(v.id); return url && (
                  <li key={v.id} className="card space-y-1">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block no-underline" aria-label={`${v.title} by ${v.channel}, ${num(v.viewsPerHour)} views per hour, opens on YouTube`}>
                      <span className="block truncate text-sm font-semibold">{v.hot ? "🔥 " : ""}{v.title}</span>
                      <span className="muted block truncate text-xs">{v.channel} · 👁 {num(v.views)} · +{num(v.viewsPerHour)} views/h · {v.ageHours < 24 ? `${Math.round(v.ageHours)} h` : `${(v.ageHours / 24).toFixed(1)} d`} old</span>
                      <span className="block text-xs" style={{ color: PINK }}>💡 Clip ideas from this: find the stream behind it and clip the same kind of moment from your creators.</span>
                    </a>
                    <StudyButton id={v.id} title={v.title} channel={v.channel} views={v.views} source="niche" />
                  </li>); })}
              </ol>
              {viral && !!viral.queries.length && <p className="muted text-xs">Searched: {viral.queries.join(", ")} · uses ~{viral.queries.length * 100 + 1} of 10,000 daily quota · cached 3 h · {new Date(viral.at).toLocaleTimeString()}</p>}
            </div>
          )}
          {rising && <ReachPanel />}
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
