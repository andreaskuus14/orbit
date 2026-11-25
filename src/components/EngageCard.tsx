"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";
import type { EngageShort, EngageState, ReplyDrafts } from "@/lib/clips/engage-pure";

// "Comments to answer" (Clip Factory → Insights): unanswered top comments on the latest published Shorts, Claude reply drafts
// and a pinned-comment idea. ORBIT can't post (read-only YouTube scopes): Copy + open YouTube Studio. Data: /api/studio/clips/engage.

const API = "/api/studio/clips/engage";
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
const when = (iso?: string) => { const ms = iso ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

function Copy({ text, what }: { text: string; what: string }) {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return <><button className="chip !px-2 !py-0.5 !text-[10px]" aria-label={t("eng.copyL", { what })}
    onClick={() => navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }, () => setOk(false))}>{ok ? `✓ ${t("eng.copied")}` : t("eng.copy")}</button>
    <span role="status" className="sr-only">{ok ? t("eng.copied") : ""}</span></>;
}

function ShortItem({ s }: { s: EngageShort }) {
  const { t } = useT();
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
        <span className="muted">· {t("eng.unanswered", { n: s.comments.length })}</span>
        <a className="muted ml-auto underline" href={studio} {...ext}>{t("eng.openStudio")} ↗</a>
      </div>
      {s.error && <p className="muted">⚠ {s.error}</p>}
      {!!s.comments.length && <ul className="space-y-1">{s.comments.map((c) => {
        const r = reply(c.id);
        return (
          <li key={c.id}>
            <p><span className="muted">{c.author}{c.likes ? ` · ♥ ${c.likes}` : ""}:</span> {c.text}</p>
            {r && <p className="flex flex-wrap items-center gap-1 pl-3"><span>↳ {r}</span> <Copy text={r} what={t("eng.replyTo", { a: c.author })} /></p>}
          </li>);
      })}</ul>}
      {!!s.comments.length && <button className="chip" onClick={draft} disabled={busy}>{busy ? t("eng.drafting") : d ? `✨ ${t("eng.again")}` : `✨ ${t("eng.draft")}`}</button>}
      {d?.pinned && <p className="flex flex-wrap items-center gap-1"><span className="muted">📌 {t("eng.pin")}</span> {d.pinned} <Copy text={d.pinned} what={t("eng.pinned")} /></p>}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  );
}

export default function EngageCard() {
  const { t } = useT();
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
    <details className="card text-xs" aria-label={t("eng.title")} open>
      <summary className="hud-title studio-title cursor-pointer !text-[0.7rem]">{t("eng.title")} <span className="muted normal-case">· {t("eng.updated", { when: when(d?.fetchedAt) || t("eng.never") })}</span></summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="chip" onClick={() => load(true)} disabled={busy || fresh} title={fresh ? t("eng.freshTip") : undefined}>{busy ? t("eng.loading") : `↻ ${t("eng.refresh")}`}</button>
          <span className="muted">{t("eng.help")}</span>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        {d && (d.shorts.length ? <ul className="space-y-2">{d.shorts.map((s) => <ShortItem key={s.videoId} s={s} />)}</ul> : <p className="muted">{t("eng.noShorts")}</p>)}
      </div>
    </details>
  );
}

/** "✨ Write description" for the publish form: Claude's description + credit + hashtags, handed to onText (the field stays editable). */
export function DescribeButton({ job, clip, onText }: { job: string; clip: string; onText: (text: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = () => { setBusy(true); setErr(""); call<{ description: string }>(API, { job, clip }).then((r) => onText(r.description.replace(/[<>]/g, "")), (e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  return <span className="inline-flex flex-wrap items-center gap-1">
    <button type="button" className="chip !px-2 !py-0.5 !text-[10px]" onClick={go} disabled={busy}>{busy ? t("eng.writing") : `✨ ${t("eng.describe")}`}</button>
    {err && <span className="error text-[11px]" role="alert">{err}</span>}
  </span>;
}
