"use client";
// Mission control → Open loops (lib/loops.ts): promises, stalled work and waiting drafts from last night's scan.
// Close / Snooze / Turn into task only change his own bookkeeping; nothing here sends, signs or approves anything.
import { useCallback, useEffect, useState } from "react";
import type { Loop } from "@/lib/loops-pure";
import { ACTIVE_CHAT_KEY } from "@/lib/core-chats-pure";
import type { PanelId } from "@/lib/planets";
import { useT } from "./i18n";

type View = { at?: string; open: Loop[] };

export function OpenLoops({ go }: { go: (panel: PanelId) => void }) {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback((scan = false) => fetch(`/api/loops${scan ? "?scan=1" : ""}`, { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setV(j)), () => setErr("Open loops unavailable")), []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, action: "close" | "snooze" | "task") => {
    setErr("");
    const r = await fetch("/api/loops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, action }) }).then((r) => r.json(), () => ({ error: "Failed" }));
    if (r.error) setErr(r.error); else setV((p) => p && { ...p, open: p.open.filter((l) => l.key !== key) });
  };
  const open = (l: Loop) => {
    if (l.evidence.chat) try { localStorage.setItem(ACTIVE_CHAT_KEY, l.evidence.chat); } catch { /* private mode */ }
    go(l.evidence.panel);
  };

  const list = v?.open ?? [];
  return (
    <section className="mc-panel" aria-label={t("loops.title")}>
      <header><span>{t("loops.title")}</span><span className="mc-code">{v ? t("loops.count", { n: list.length }) : "…"}</span></header>
      {err && <p className="mc-sub mc-warn">{err}</p>}
      {v && !list.length && <p className="mc-dim">{t("loops.empty")}</p>}
      {list.length > 0 && <ul>{list.slice(0, 8).map((l) => (
        <li key={l.key}>
          <div className="mc-sub">{l.title}</div>
          <div className="mc-sub mc-dim">▸ {l.next} · <button className="chip" onClick={() => open(l)}>{l.evidence.label}</button></div>
          <div className="mc-actions">
            <button className="chip" onClick={() => act(l.key, "close")}>{t("common.close")}</button>
            <button className="chip" onClick={() => act(l.key, "snooze")}>{t("loops.snooze")}</button>
            <button className="chip" onClick={() => act(l.key, "task")}>{t("loops.task")}</button>
          </div>
        </li>))}</ul>}
      <div className="mc-actions"><button className="chip" onClick={() => load(true)}>{t("loops.scan")}</button></div>
    </section>
  );
}
