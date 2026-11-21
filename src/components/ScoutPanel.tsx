"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import { SCOUT_CHANGED } from "./scout-nav";
import { FIT_LABEL, type Candidate } from "@/lib/feature-scout-pure";

// OPERATIONS → Scout: the feature scout's candidates (feature-scout.ts). Opening a card stops its galaxy moon glowing;
// "Prototype it" (ready ones only) creates an agent task. Nothing here installs or downloads.
type Board = { candidates: Candidate[]; glowing: number; lastOk: string | null; status: string | null; lastError: string | null; busy: boolean; off: boolean };
const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : "#");

async function post(body: object) {
  const res = await fetch("/api/scout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Could not update the scout");
  dispatchEvent(new CustomEvent(SCOUT_CHANGED));
  return j as { taskId?: string };
}

export function ScoutPanel({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { t } = useT();
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scout", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not load the scout");
      setB(j); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!b?.busy) return;
    const h = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(h);
  }, [b?.busy, load]);

  const act = async (key: string, action: string) => {
    setBusy(`${action}:${key}`);
    try { const r = await post({ action, key }); await load(); if (r.taskId && action === "prototype") onOpenTask(r.taskId); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };
  const run = async () => { setBusy("run"); try { await post({ action: "run" }); setTimeout(() => void load(), 800); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } };

  const card = (c: Candidate) => (
    <li key={c.key} className="card">
      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && c.status === "new") void act(c.key, "open"); }}>
        <summary className="cursor-pointer">
          <span className="font-medium">{c.name}</span>
          {c.status === "new" && <span className="chip ml-2 text-xs" style={{ borderColor: "var(--cyan)" }}>{t("scout.new")}</span>}
          <span className="muted ml-2 text-xs">{c.kind} · {c.source} · {c.areaLabel} · {t("scout.score", { n: c.score })}</span>
        </summary>
        <div className="mt-2 space-y-1 text-sm">
          <p><b>{t("scout.improves")}:</b> {c.improves || c.areaLabel}</p>
          {c.why && <p className="muted">{c.why}</p>}
          {c.vs && <p className="muted">{t("scout.vs", { name: c.vs })}</p>}
          <p><b>{t("scout.license")}:</b> {c.licenseLabel.slice(0, 80)} <span className="muted">({c.licenseClass})</span></p>
          <p><b>{t("scout.size")}:</b> {FIT_LABEL[c.fit]}{c.vramGb ? ` · ${t("scout.vram", { gb: c.vramGb })}` : ""}</p>
          <p className="muted text-xs">{c.what}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a className="chip" href={safeHref(c.url)} target="_blank" rel="noreferrer noopener">{t("scout.source")}</a>
            {c.ready && !c.taskId && <button className="btn" disabled={!!busy} onClick={() => void act(c.key, "prototype")} title={t("scout.protoHelp")}>{t("scout.prototype")}</button>}
            {c.taskId && <button className="chip" onClick={() => onOpenTask(c.taskId!)}>{t("scout.prototyped")} · {t("scout.openTask")}</button>}
            <button className="chip" disabled={!!busy} onClick={() => void act(c.key, "dismiss")}>{t("scout.dismiss")}</button>
          </div>
        </div>
      </details>
    </li>
  );
  const ready = b?.candidates.filter((c) => c.ready) ?? [], watch = b?.candidates.filter((c) => !c.ready) ?? [];
  return (
    <div className="space-y-3">
      <p className="muted text-sm">{t("scout.intro")}</p>
      {b?.off && <p className="muted">{t("scout.off")}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button className="chip" disabled={!!busy || b?.busy || b?.off} onClick={() => void run()}>{b?.busy || busy === "run" ? t("scout.checking") : t("scout.check")}</button>
        <span className="muted">{t("scout.last", { when: b?.lastOk ? new Date(b.lastOk).toLocaleString() : t("scout.never") })}{b?.status ? ` · ${b.status}` : ""}</span>
      </div>
      {(err || b?.lastError) && <p className="error" role="alert">{err || b?.lastError}</p>}
      {b && !b.candidates.length && <p className="muted">{t("scout.empty")}</p>}
      {ready.length > 0 && <><h3 className="font-medium">{t("scout.ready")}</h3><ul className="space-y-2">{ready.map(card)}</ul></>}
      {watch.length > 0 && <details><summary className="muted cursor-pointer text-sm">{t("scout.watch")} · {watch.length}</summary><ul className="mt-2 space-y-2">{watch.map(card)}</ul></details>}
    </div>
  );
}
