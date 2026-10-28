"use client";
// "Needs you": the home HUD's main card. One deduplicated list (needs-you-pure) of decisions, blockers and finished results, each
// with one action on its existing route. Polls /api/needs-you every 60 s while visible. Continue my work and Mission control stay one tap away.
import { useCallback, useEffect, useId, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { MARKETS_TAB, type BriefOpen } from "@/lib/brief-pure";
import type { Need } from "@/lib/needs-you-pure";
import { api } from "./AgentMission";
import { useT } from "./i18n";

const SHOWN = 5;
const nav = (detail: NavTarget) => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail }));

/** Go where a brief / inbox item points (shared with MorningBriefBody). */
export function openTarget(o: BriefOpen, onOpenTask: (id: string) => void, onOpenGoal: (id: string) => void) {
  if ("href" in o) window.open(o.href, "_blank", "noopener,noreferrer");
  else if ("task" in o) onOpenTask(o.task);
  else if ("goal" in o) onOpenGoal(o.goal);
  else if ("work" in o) (o.work.kind === "task" ? onOpenTask : onOpenGoal)(o.work.id);
  else if ("memory" in o) dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: o.memory } }));
  else if ("study" in o) nav({ panel: "memory", study: true });
  else if ("mission" in o) nav({ panel: null, mission: true });
  else if ("doctor" in o) nav({ panel: null, doctor: true });
  else if ("tab" in o) { try { sessionStorage.setItem(MARKETS_TAB, o.tab); } catch { /* opens on Watchlist */ } nav({ panel: o.panel }); }
  else nav({ panel: o.panel, ...(o.view && { view: o.view }) });
}

export function NeedsYou({ onOpenTask, onOpenGoal }: { onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const { t, lang } = useT();
  const titleId = useId();
  const [items, setItems] = useState<Need[] | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Record<string, string>>({}); // ref → what happened here
  const [busy, setBusy] = useState("");

  const load = useCallback(() => fetch(`/api/needs-you?lang=${lang}`, { cache: "no-store" }).then((r) => r.json())
    .then((j: { items?: Need[]; error?: string }) => { if (!j.items) throw new Error(j.error); setItems(j.items); setErr(""); })
    .catch(() => setErr(t("needs.loadFailed"))), [lang, t]);
  useEffect(() => {
    void load();
    const h = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => clearInterval(h);
  }, [load]);

  const act = async (n: Need) => {
    const a = n.act;
    if ("open" in a) return openTarget(a.open, onOpenTask, onOpenGoal);
    setBusy(n.ref); setErr("");
    try {
      if ("trust" in a) await api("/api/autonomy", { method: "POST", body: JSON.stringify({ action: "level", area: a.trust, level: "do" }) });
      else if ("task" in a.approve) await api(`/api/tasks/${a.approve.task}`, { method: "POST", body: JSON.stringify({ action: "approve" }) });
      else await api("/api/goals", { method: "POST", body: JSON.stringify({ action: "ok", id: a.approve.goal, step: a.approve.step, stepId: a.approve.stepId }) });
      setDone((d) => ({ ...d, [n.ref]: t("common.approved") }));
    } catch (e) { setErr(e instanceof Error ? e.message : t("common.failed")); }
    finally { setBusy(""); }
  };
  const label = (n: Need) => "approve" in n.act ? t("common.approve") : "trust" in n.act ? t("needs.accept") : t("common.open");
  const list = items ?? [];

  return <section className="continue-work continue-work-float needs-you" aria-labelledby={titleId}>
    <div className="continue-heading"><h2 id={titleId}>{t("needs.title")}{items?.length ? ` · ${items.length}` : ""}</h2>
      <span className="flex items-center gap-2">
        <button type="button" className="link" onClick={() => nav({ panel: null, continueWork: true })}>{t("needs.work")}</button>
        <button type="button" className="link" onClick={() => nav({ panel: null, mission: true })}>{t("needs.mission")}</button>
      </span></div>
    {err && <p className="error" role="alert">{err}</p>}
    {!items && !err && <p className="muted" role="status">{t("needs.loading")}</p>}
    {items && !items.length && <p className="muted">{t("needs.empty")}</p>}
    {!!list.length && <ul>{list.slice(0, SHOWN).map((n) => <li key={n.ref} data-status={n.kind === "decide" ? "awaiting_approval" : n.kind === "unblock" ? "failed" : "done"}>
      <span><small className="continue-kind">{t(`needs.kind.${n.kind}`)}</small><b>{n.title}</b>{n.detail && <small>{n.detail}</small>}</span>
      {done[n.ref] ? <small>{done[n.ref]}</small>
        : <button type="button" className="chip" disabled={!!busy} aria-label={`${label(n)}: ${n.title}`} onClick={() => void act(n)}>{busy === n.ref ? "…" : label(n)}</button>}
    </li>)}</ul>}
    {list.length > SHOWN && <p className="muted">{t("needs.more", { n: list.length - SHOWN })}</p>}
  </section>;
}
