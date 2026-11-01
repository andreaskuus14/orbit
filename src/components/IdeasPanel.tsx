"use client";
import { useCallback, useEffect, useState } from "react";
import { board, freshnessLabel, isStale, TRANSCRIPT_MAX, type Idea } from "@/lib/ideas-pure";
import { commentUrl } from "@/lib/comment-ideas-pure";
import { useT } from "./i18n";

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
  const { t } = useT();
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
  async function readTranscript(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true); setMsg(null);
    try {
      const j = await call({ action: "transcript", title: data.get("title"), transcript: data.get("transcript"), publicSource: data.get("publicSource") === "yes" });
      setB(j); form.reset(); setMsg({ ok: true, text: t("ideas.transcript.saved", { n: j.found ?? 0 }) });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  // A shared link only fills the box: reading it is the owner's own click (a link from anyone else can't spend Claude usage).
  useEffect(() => { void load(); if (initialUrl) { setUrl(initialUrl); onConsumed?.(); } }, [load, initialUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now();
  const shown = board(b?.shown ?? [], now).shown.filter((i) => i.origin === "transcript" || !hideStale || !isStale(i, now));
  const stale = b?.shown.filter((i) => i.origin !== "transcript" && isStale(i, now)).length ?? 0;
  return (
    <div className="space-y-3 text-sm">
      <form className="flex gap-1.5" aria-label="Read a video for ideas" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void read(url.trim()); }}>
        <input className="field flex-1" aria-label="YouTube link" placeholder="Paste a YouTube link…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy || !url.trim()}>{busy ? "Reading…" : "Find ideas"}</button>
      </form>
      <details>
        <summary className="cursor-pointer">{t("ideas.transcript.title")}</summary>
        <form className="mt-2 space-y-2" aria-label={t("ideas.transcript.title")} onSubmit={(e) => { e.preventDefault(); void readTranscript(e.currentTarget); }}>
          <p className="muted text-xs">{t("ideas.transcript.help")}</p>
          <input className="field w-full" name="title" required maxLength={200} aria-label={t("ideas.transcript.source")} placeholder={t("ideas.transcript.source")} />
          <textarea className="field w-full" name="transcript" required minLength={200} maxLength={TRANSCRIPT_MAX} rows={7} aria-label={t("ideas.transcript.text")} placeholder={t("ideas.transcript.text")} />
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="publicSource" value="yes" required />{t("ideas.transcript.public")}</label>
          <button className="btn" disabled={busy}>{t("ideas.transcript.analyze")}</button>
        </form>
      </details>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={hideStale} onChange={(e) => setHideStale(e.target.checked)} />Hide stale</label>
      {busy && <p className="muted" role="status">{t("ideas.reading")}</p>}
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {b && !shown.length && <p className="muted">{hideStale && stale ? "No fresh strong ideas. Turn off Hide stale to see older ideas." : "No strong ideas yet. Paste a video about side hustles, tools or channel growth."}</p>}
      {hideStale && stale > 0 && <p className="muted text-xs">{stale} stale ideas hidden.</p>}
      <ul className="space-y-2">{shown.map((i) => (
        <li key={i.id} className={`card space-y-1${i.origin !== "transcript" && isStale(i, now) ? " opacity-50 grayscale" : ""}`}>
          <div className="flex items-baseline justify-between gap-2"><b>{i.title}</b><span className="muted text-xs">{AREA[i.area] ?? i.area} · {i.score}</span></div>
          {i.summary && <p className="muted">{i.summary}</p>}
          <p className="muted text-xs">{i.origin === "transcript" ? t("ideas.transcript.unverified") : <>{freshnessLabel(i, now)}{isStale(i, now) ? " · stale" : ""}</>}</p>
          {i.next && <p><b>Next:</b> {i.next}</p>}
          {!!i.comments?.length && <details className="text-xs"><summary className="cursor-pointer">{i.askers ?? i.comments.length} viewers asked: see the comments</summary>
            <ul className="mt-1 space-y-0.5">{i.comments.map((c) => <li key={c.id}><a className="link" href={commentUrl(c)} target="_blank" rel="noopener noreferrer">“{c.text}”<span className="sr-only"> (opens YouTube)</span></a></li>)}</ul>
          </details>}
          <div className="flex items-center justify-between gap-2 text-xs">
            {i.origin === "devsession" || i.origin === "transcript" ? <span className="muted">From: {i.videoTitle}</span>
              : <a className="link" href={`https://www.youtube.com/watch?v=${i.video}`} target="_blank" rel="noopener noreferrer">From: {i.videoTitle} <span className="sr-only">(opens YouTube)</span></a>}
            <button type="button" className="chip" onClick={() => call({ action: "dismiss", id: i.id }).then(setB, (e: Error) => setMsg({ ok: false, text: e.message }))}>Hide</button>
          </div>
        </li>))}</ul>
      {!!b?.hidden && <p className="muted text-xs">{b.hidden} weaker or hidden ideas are saved too.</p>}
    </div>
  );
}
