"use client";
import { useCallback, useEffect, useState } from "react";
import { contentHash } from "@/lib/approval-pure";
import { isLive, kaggleContent, type Job, type Offer, type Quota } from "@/lib/kaggle-pure";
import { useT } from "./i18n";

// OPERATIONS → Local AI → Kaggle burst (lib/kaggle.ts, /api/kaggle). Each upload is his own two clicks on one offer whose exact script he can read.
type View = { on: boolean; setup: { ok: boolean; hint: string }; quota: Quota | null; hoursLeft: number; job: Job | null; offers: Offer[] };

export function KaggleBurst() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState("");
  const [sure, setSure] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => { void fetch("/api/kaggle", { cache: "no-store" }).then((r) => r.json()).then(setV, () => setV(null)); }, []);
  useEffect(load, [load]);
  const live = isLive(v?.job);
  useEffect(() => { if (!live) return; const i = setInterval(load, 30_000); return () => clearInterval(i); }, [live, load]);
  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try {
      const r = await fetch("/api/kaggle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok || j.error) throw new Error(j.error || `Request failed (${r.status})`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(""); load(); }
  };
  const send = (o: Offer) => {
    if (sure !== o.id) { setSure(o.id); setTimeout(() => setSure(""), 5000); return; }
    setSure("");
    void contentHash(kaggleContent(o)).then((seen) => act(o.id, { action: "approve", id: o.id, seen }));
  };
  if (!v) return null;
  const j = v.job;
  return (
    <div className="glass grid gap-1 rounded-lg p-2 text-xs" aria-label={t("kag.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>{t("kag.title")}</b>
        <span className="muted">{!v.on ? t("kag.off") : !v.setup.ok ? t("kag.notSetUp", { hint: v.setup.hint })
          : `${t("kag.hours", { left: `${v.hoursLeft.toFixed(1)} h` })}${v.quota?.refreshAt ? ` · ${t("kag.resets", { at: new Date(v.quota.refreshAt).toLocaleString() })}` : ""}`}</span>
      </div>
      <p className="muted">{t("kag.help")} Setup: <code className="select-all">powershell -ExecutionPolicy Bypass -File tools\kaggle\setup.ps1</code></p>
      {j && (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("kag.job", { title: j.title })}: <b>{t(`kag.st.${j.status}` as Parameters<typeof t>[0])}</b></span>
            {live && <button className="chip" disabled={!!busy} onClick={() => void act("cancel", { action: "cancel" })}>{t("kag.cancel")}</button>}
          </div>
          {j.error && <p style={{ color: "#fbbf24" }}>{j.error}</p>}
          {j.saved?.length ? <p>{t("kag.saved", { files: j.saved.join(", ") })}</p> : null}
        </div>
      )}
      {v.offers.map((o) => (
        <div key={o.id} className="card grid gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><b>{o.title}</b><span className="muted">{t("kag.offer")} · {t("kag.about", { h: String(o.hours) })}</span></div>
          <p>{o.why}</p>
          <p className="muted">{t("kag.sends")}</p>
          <details><summary className="cursor-pointer">{t("kag.script")}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px]">{o.script}</pre></details>
          <div className="flex gap-2">
            <button className={`btn ${sure === o.id ? "ok" : ""}`} disabled={!!busy || live || !v.on || !v.setup.ok} onClick={() => send(o)}>{sure === o.id ? t("kag.sure") : t("kag.send")}</button>
            <button className="chip" disabled={!!busy} onClick={() => void act(o.id, { action: "decline", id: o.id })}>{t("kag.no")}</button>
          </div>
        </div>
      ))}
      {err && <p style={{ color: "#fbbf24" }}>{err}</p>}
    </div>
  );
}
