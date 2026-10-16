"use client";
import { useEffect, useState } from "react";
import type { EngageShort, EngageState, ReplyDrafts } from "@/lib/clips/engage-pure";

// "Comments to answer" (Clip Factory → Insights): unanswered top comments on the latest published Shorts, Claude reply drafts
// and a pinned-comment idea. ORBIT can't post (read-only YouTube scopes): Copy + open YouTube Studio. Data: /api/studio/clips/engage.

const API = "/api/studio/clips/engage";
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
const when = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never"; };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

function Copy({ text, what }: { text: string; what: string }) {
  const [ok, setOk] = useState(false);
  return <><button className="chip !px-2 !py-0.5 !text-[10px]" aria-label={`Copy ${what}`}
    onClick={() => navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }, () => setOk(false))}>{ok ? "✓ Copied" : "Copy"}</button>
    <span role="status" className="sr-only">{ok ? "Copied" : ""}</span></>;
}

function ShortItem({ s }: { s: EngageShort }) {
  const [d, setD] = useState<ReplyDrafts | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const studio = `https://studio.youtube.com/video/${s.videoId}/comments`;
  const draft = () => { setBusy(true); setErr(""); call<ReplyDrafts>(API, { videoId: s.videoId }).then(setD, (e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  const reply = (id: string) => d?.replies.find((r) => r.commentId === id)?.text;
  return (
    <li className="space-y-1 rounded-md border border-white/10 p-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <a className="underline" href={`https://youtube.com/shorts/${s.videoId}`} {...ext}>{s.title}</a>
        <span className="muted">· {s.comments.length} unanswered</span>
        <a className="muted ml-auto underline" href={studio} {...ext}>Open in YouTube Studio ↗</a>
      </div>
      {s.error && <p className="muted">⚠ {s.error}</p>}
      {!!s.comments.length && <ul className="space-y-1">{s.comments.map((c) => {
        const r = reply(c.id);
        return (
          <li key={c.id}>
            <p><span className="muted">{c.author}{c.likes ? ` · ♥ ${c.likes}` : ""}:</span> {c.text}</p>
            {r && <p className="flex flex-wrap items-center gap-1 pl-3"><span>↳ {r}</span> <Copy text={r} what={`reply to ${c.author}`} /></p>}
          </li>);
      })}</ul>}
      {!!s.comments.length && <button className="chip" onClick={draft} disabled={busy}>{busy ? "Drafting…" : d ? "✨ Draft again" : "✨ Draft replies"}</button>}
      {d?.pinned && <p className="flex flex-wrap items-center gap-1"><span className="muted">📌 Pin:</span> {d.pinned} <Copy text={d.pinned} what="pinned comment" /></p>}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  );
}

export default function EngageCard() {
  const [d, setD] = useState<EngageState | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = (refresh = false) => {
    setBusy(true); setErr("");
    call<EngageState>(`${API}${refresh ? "?refresh=1" : ""}`).then(setD, (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => load(), []);
  const fresh = !!d && Date.now() - Date.parse(d.fetchedAt) < 30 * 60_000;
  return (
    <details className="card text-xs" aria-label="Comments to answer" open>
      <summary className="hud-title studio-title cursor-pointer !text-[0.7rem]">COMMENTS TO ANSWER <span className="muted normal-case">· updated {when(d?.fetchedAt)}</span></summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="chip" onClick={() => load(true)} disabled={busy || fresh} title={fresh ? "Refreshes at most every 30 minutes" : undefined}>{busy ? "Loading…" : "↻ Refresh"}</button>
          <span className="muted">ORBIT drafts replies; you post them in YouTube Studio.</span>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        {d && (d.shorts.length ? <ul className="space-y-2">{d.shorts.map((s) => <ShortItem key={s.videoId} s={s} />)}</ul> : <p className="muted">No published Shorts yet.</p>)}
      </div>
    </details>
  );
}

/** "✨ Write description" for the publish form: Claude's description + credit + hashtags, handed to onText (the field stays editable). */
export function DescribeButton({ job, clip, onText }: { job: string; clip: string; onText: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = () => { setBusy(true); setErr(""); call<{ description: string }>(API, { job, clip }).then((r) => onText(r.description.replace(/[<>]/g, "")), (e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  return <span className="inline-flex flex-wrap items-center gap-1">
    <button type="button" className="chip !px-2 !py-0.5 !text-[10px]" onClick={go} disabled={busy}>{busy ? "Writing…" : "✨ Write description"}</button>
    {err && <span className="error text-[11px]" role="alert">{err}</span>}
  </span>;
}
