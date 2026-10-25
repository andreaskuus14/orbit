"use client";
import { useCallback, useEffect, useState } from "react";
import { board, freshnessLabel, isStale, type Idea } from "@/lib/ideas-pure";
import { commentUrl } from "@/lib/comment-ideas-pure";

// IDEA RADAR board (Agents Station → Ideas). Paste a YouTube link; CORE reads its captions and scores every idea.
type Board = { shown: Idea[]; hidden: number; busy: string | null; found?: number };
const AREA: Record<string, string> = { studio: "🎬 STUDIO", business: "💼 BUSINESS", markets: "📈 MARKETS", agents: "🤖 AGENTS", core: "🧠 CORE", gamedev: "🎮 GAME DEV", other: "Other" };

async function call(body?: object): Promise<Board> {
  const r = await fetch("/api/ideas", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export default function IdeasPanel({ initialUrl, onConsumed }: { initialUrl?: string | null; onConsumed?: () => void }) {
  const [b, setB] = useState<Board | null>(null);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [hideStale, setHideStale] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => call().then(setB, (e: Error) => setMsg({ ok: false, text: e.message })), []);
  const read = useCallback(async (u: string) => {
    setBusy(true); setMsg(null);
    try { const j = await call({ action: "radar", url: u }); setB(j); setUrl(""); setMsg({ ok: true, text: `Found ${j.found} ideas; the strong ones are on the board.` }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }, []);
  // A shared link only fills the box: reading it is the owner's own click (a link from anyone else can't spend Claude usage).
  useEffect(() => { void load(); if (initialUrl) { setUrl(initialUrl); onConsumed?.(); } }, [load, initialUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now();
  const shown = board(b?.shown ?? [], now).shown.filter((i) => !hideStale || !isStale(i, now));
  const stale = b?.shown.filter((i) => isStale(i, now)).length ?? 0;
  return (
    <div className="space-y-3 text-sm">
      <form className="flex gap-1.5" aria-label="Read a video for ideas" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void read(url.trim()); }}>
        <input className="field flex-1" aria-label="YouTube link" placeholder="Paste a YouTube link…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy || !url.trim()}>{busy ? "Reading…" : "Find ideas"}</button>
      </form>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={hideStale} onChange={(e) => setHideStale(e.target.checked)} />Hide stale</label>
      {busy && <p className="muted" role="status">Checking the source date, then reading the captions and scoring every idea (about a minute). If YouTube refuses the captions, ORBIT listens to the first 30 minutes instead, which takes a few minutes…</p>}
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {b && !shown.length && <p className="muted">{hideStale && stale ? "No fresh strong ideas. Turn off Hide stale to see older ideas." : "No strong ideas yet. Paste a video about side hustles, tools or channel growth."}</p>}
      {hideStale && stale > 0 && <p className="muted text-xs">{stale} stale ideas hidden.</p>}
      <ul className="space-y-2">{shown.map((i) => (
        <li key={i.id} className={`card space-y-1${isStale(i, now) ? " opacity-50 grayscale" : ""}`}>
          <div className="flex items-baseline justify-between gap-2"><b>{i.title}</b><span className="muted text-xs">{AREA[i.area] ?? i.area} · {i.score}</span></div>
          {i.summary && <p className="muted">{i.summary}</p>}
          <p className="muted text-xs">{freshnessLabel(i, now)}{isStale(i, now) ? " · stale" : ""}</p>
          {i.next && <p><b>Next:</b> {i.next}</p>}
          {!!i.comments?.length && <details className="text-xs"><summary className="cursor-pointer">{i.askers ?? i.comments.length} viewers asked: see the comments</summary>
            <ul className="mt-1 space-y-0.5">{i.comments.map((c) => <li key={c.id}><a className="link" href={commentUrl(c)} target="_blank" rel="noopener noreferrer">“{c.text}”<span className="sr-only"> (opens YouTube)</span></a></li>)}</ul>
          </details>}
          <div className="flex items-center justify-between gap-2 text-xs">
            {i.origin === "devsession" ? <span className="muted">From: {i.videoTitle}</span>
              : <a className="link" href={`https://www.youtube.com/watch?v=${i.video}`} target="_blank" rel="noopener noreferrer">From: {i.videoTitle} <span className="sr-only">(opens YouTube)</span></a>}
            <button type="button" className="chip" onClick={() => call({ action: "dismiss", id: i.id }).then(setB, (e: Error) => setMsg({ ok: false, text: e.message }))}>Hide</button>
          </div>
        </li>))}</ul>
      {!!b?.hidden && <p className="muted text-xs">{b.hidden} weaker or hidden ideas are saved too.</p>}
    </div>
  );
}
