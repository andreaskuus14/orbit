"use client";
import { useEffect, useState } from "react";
import { useT } from "../i18n";

// The background "Hey Orbit" listener (tools/voice, jarvis.ts): its toggle in Voice settings, and the card for level-3 PC actions
// waiting for the owner's click (pc-policy-pure). Polls only while the tab is visible.
type DeskState = { on: boolean; peripheral: boolean; everySec: number; envOff: boolean; helper: boolean };

export function DeskVoiceToggle() {
  const { t } = useT();
  const [s, setS] = useState<DeskState | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch("/api/voice/desk-settings").then((r) => (r.ok ? r.json() : null)).then(setS, () => setS(null)); }, []);
  const save = async (patch: Partial<DeskState>) => {
    setErr("");
    const r = await fetch("/api/voice/desk-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) setS(await r.json()); else setErr(t("dvoice.saveFail"));
  };
  if (!s) return null;
  return (
    <label className="voice-col">{t("dvoice.title")}
      <label className="voice-row"><input type="checkbox" checked={s.on} disabled={s.envOff} onChange={(e) => void save({ on: e.target.checked })} /> {t("dvoice.listen")}</label>
      {s.on && <label className="voice-row"><input type="checkbox" checked={s.peripheral} onChange={(e) => void save({ peripheral: e.target.checked })} /> {t("dvoice.peripheral", { n: s.everySec })}</label>}
      <span className="muted text-[10px]">{s.envOff ? t("dvoice.envOff") : !s.helper ? t("dvoice.noHelper") : t("dvoice.running")}</span>
      {err && <span className="text-red-400 text-[10px]" role="alert">{err}</span>}
    </label>
  );
}

type Pending = { id: string; summary: string; click: boolean; at: number };

export function PcConfirm() {
  const { t } = useT();
  const [items, setItems] = useState<Pending[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const j = await fetch("/api/pc").then((r) => (r.ok ? r.json() : null), () => null) as { pending?: Pending[] } | null;
      if (!stop && j?.pending) setItems(j.pending);
    };
    void tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, []);
  const answer = async (id: string, allow: boolean) => {
    const r = await fetch("/api/pc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, allow }) });
    const j = await r.json().catch(() => ({})) as { text?: string };
    setMsg(j.text ?? ""); setItems((xs) => xs.filter((x) => x.id !== id));
    setTimeout(() => setMsg(""), 6000);
  };
  if (!items.length && !msg) return null;
  return (
    <div className="glass fixed bottom-4 right-4 z-50 max-w-sm p-3 text-xs" role="alertdialog" aria-label={t("dvoice.actL")}>
      {items.map((p) => (
        <div key={p.id} className="mb-2">
          <div className="font-semibold">{t("dvoice.wants", { s: p.summary })}</div>
          <div className="mt-1 flex gap-2">
            <button type="button" className="chip" onClick={() => void answer(p.id, true)}>{t("dvoice.allow")}</button>
            <button type="button" className="chip" onClick={() => void answer(p.id, false)}>{t("dvoice.deny")}</button>
          </div>
        </div>
      ))}
      {msg && <div className="muted">{msg}</div>}
    </div>
  );
}
