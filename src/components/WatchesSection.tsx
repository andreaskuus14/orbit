"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Change, Watch } from "@/lib/pagewatch-pure";

type Row = Omit<Watch, "snaps"> & { versions: number };
type Board = { watches: Row[]; changes: (Change & { purpose: string; url: string })[]; week?: { useful: number; noise: number; unmarked: number; missed: number; checks: number; failedChecks: number } };
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");
const EVERY = [1, 6, 24, 168] as const;

export async function postWatch(body: object): Promise<void> {
  const res = await fetch("/api/watches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Could not update the watch");
}

/** INTELLIGENCE → Watches: page-change watches with freshness (checked / changed / last error) and each change as added/removed lines. */
export function WatchesSection() {
  const { t } = useT();
  const [b, setB] = useState<Board | null>(null);
  const [f, setF] = useState({ url: "", focus: "", purpose: "", every: 24, render: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : t("pw.never"));

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watches", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not load watches");
      setB(j); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load watches"); }
  }, []);
  useEffect(() => { void load(); const i = setInterval(load, 60_000); return () => clearInterval(i); }, [load]);

  const act = async (key: string, body: object) => {
    setBusy(key);
    try { await postWatch(body); setErr(""); if ((body as { action: string }).action === "add") setF({ url: "", focus: "", purpose: "", every: 24, render: false }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
    finally { setBusy(""); void load(); }
  };

  return (
    <div className="card space-y-2 text-sm">
      <div><b>{t("pw.title")}</b> <span className="muted">· {t("pw.note")}</span></div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (f.url.trim()) void act("add", { action: "add", ...f }); }}>
        <input className="field min-w-48 flex-1" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={t("pw.url")} aria-label={t("pw.url")} maxLength={500} />
        <input className="field min-w-40 flex-1" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder={t("pw.purpose")} aria-label={t("pw.purpose")} maxLength={120} />
        <input className="field min-w-40 flex-1" value={f.focus} onChange={(e) => setF({ ...f, focus: e.target.value })} placeholder={t("pw.focus")} aria-label={t("pw.focus")} maxLength={120} />
        <select className="chip" aria-label={t("pw.every")} value={f.every} onChange={(e) => setF({ ...f, every: Number(e.target.value) })}>
          {EVERY.map((h) => <option key={h} value={h}>{t(`pw.e.${h}` as const)}</option>)}
        </select>
        <label className="chip flex items-center gap-1" title="For pages that only show their content with JavaScript: ORBIT checks them in its hidden browser">
          <input type="checkbox" checked={f.render} onChange={(e) => setF({ ...f, render: e.target.checked })} /> JS page
        </label>
        <button className="btn" disabled={busy === "add"}>{t("pw.add")}</button>
      </form>
      {err && <p className="error">{err}</p>}
      {b?.watches.length === 0 && <p className="muted text-xs">{t("pw.none")}</p>}
      <ul className="space-y-2">
        {b?.watches.map((w) => {
          const unseen = !!w.lastChanged && (!w.seenAt || w.seenAt < w.lastChanged);
          return (
            <li key={w.id} className="rounded-md border border-white/10 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><b>{w.purpose}</b>{unseen && <span className="chip ml-2 text-xs" style={{ borderColor: "var(--cyan)" }}>{t("pw.changed", { at: when(w.lastChanged) })}</span>}
                  <br /><a className="link text-xs break-all" href={safeHref(w.url)} target="_blank" rel="noreferrer noopener">{w.url}</a>{w.focus && <span className="muted text-xs"> · {w.focus}</span>}</span>
                <span className="flex flex-wrap gap-1.5">
                  <label className="chip"><input type="checkbox" checked={w.important} onChange={(e) => void act(`imp:${w.id}`, { action: "important", id: w.id, on: e.target.checked })} /> {t("pw.important")}</label>
                  <button className="chip" disabled={!!busy} onClick={() => void act(`chk:${w.id}`, { action: "check", id: w.id })}>{busy === `chk:${w.id}` ? "…" : t("pw.check")}</button>
                  {unseen && <button className="chip" disabled={!!busy} onClick={() => void act(`seen:${w.id}`, { action: "seen", id: w.id })}>{t("pw.seen")}</button>}
                  <button className="chip" disabled={!!busy} onClick={() => { const note = window.prompt(t("pw.missedAsk")); if (note?.trim()) void act(`miss:${w.id}`, { action: "missed", id: w.id, note }); }}>{t("pw.missed")}</button>
                  <button className="chip" disabled={!!busy} onClick={() => void act(`rm:${w.id}`, { action: "remove", id: w.id })}>{t("pw.remove")}</button>
                </span>
              </div>
              <p className="muted text-xs">{(EVERY as readonly number[]).includes(w.everyH) ? t(`pw.e.${w.everyH as (typeof EVERY)[number]}`) : `${w.everyH} h`} · {t("pw.checked", { at: when(w.lastChecked) })} · {t("pw.changed", { at: when(w.lastChanged) })}</p>
              {w.lastError && <p className="error text-xs">{t("pw.error", { e: w.lastError })}</p>}
            </li>
          );
        })}
      </ul>
      {!!b?.watches.length && <div className="pt-1"><b>{t("pw.recent")}</b>{b.week && <span className="muted ml-2 text-xs">{t("pw.week", b.week)}</span>}</div>}
      {b?.watches.length && !b.changes.length ? <p className="muted text-xs">{t("pw.noChanges")}</p> : null}
      <ul className="space-y-2">
        {b?.changes.slice(0, 20).map((c) => (
          <li key={c.id} className="rounded-md border border-white/10 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              <b>{c.purpose}</b> <span className="muted">· {when(c.at)}{c.live ? ` · ${t("pw.live")}` : ""}{c.reverted ? ` · ${t("pw.reverted", { at: when(c.reverted) })}` : ""}</span>
              <a className="muted underline" href={safeHref(c.url)} target="_blank" rel="noopener noreferrer">{t("pw.source")}</a>
              <span className="ml-auto flex gap-1">
                {(["useful", "noise"] as const).map((v) => (
                  <button key={v} className="chip" aria-pressed={c.verdict === v} disabled={!!busy} style={c.verdict === v ? { borderColor: "var(--cyan)" } : undefined}
                    onClick={() => void act(`v:${c.id}`, { action: "verdict", id: c.id, verdict: c.verdict === v ? null : v })}>{t(`pw.${v}`)}</button>
                ))}
              </span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
              {c.added.map((l, i) => <span key={`a${i}`} className="block" style={{ color: "var(--green, #4ade80)" }}>+ {l}</span>)}
              {c.removed.map((l, i) => <span key={`r${i}`} className="block" style={{ color: "var(--red, #f87171)" }}>− {l}</span>)}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
