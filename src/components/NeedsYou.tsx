"use client";
// "Needs you": the home HUD's main card. One deduplicated list (needs-you-pure) of decisions, blockers and finished results, each
// with one action: open it where it is handled (Decide → "Review": the exact content and its Approve, never a one-tap approve here). Polls /api/needs-you every 60 s while visible. Continue my work and Mission control stay one tap away.
import { useCallback, useId, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { MARKETS_TAB, type BriefOpen } from "@/lib/brief-pure";
import type { Need } from "@/lib/needs-you-pure";
import { useT } from "./i18n";
import { OpsStatus } from "./OpsStatus";

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
  const [snooze, setSnooze] = useState<{ ref: string; why: string } | null>(null);
  const [open, setOpen] = useState(false); // quiet open (#352): the galaxy stays uncovered; the count waits in a chip until clicked

  const load = useCallback(() => fetch(`/api/needs-you?lang=${lang}`, { cache: "no-store" }).then((r) => r.json())
    .then((j: { items?: Need[]; error?: string }) => { if (!j.items) throw new Error(j.error); setItems(j.items); setErr(""); })
    .catch(() => setErr(t("needs.loadFailed"))), [lang, t]);
  const poll = useCallback(() => void load(), [load]);
  usePoll(poll, pollMs(60_000));

  const doSnooze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!snooze?.why.trim()) return;
    const ref = snooze.ref;
    fetch("/api/needs-you", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snooze: ref, reason: snooze.why.trim() }) })
      .then((r) => { if (!r.ok) throw new Error(); setItems((l) => l?.filter((x) => x.ref !== ref) ?? l); setSnooze(null); })
      .catch(() => setErr(t("needs.snoozeFailed")));
  };
  const label = (n: Need) => t(n.kind === "decide" ? "needs.review" : "common.open"); // Decide opens the exact content and its Approve
  const list = items ?? [];

  if (!open) return <button type="button" className="chip needs-you-chip" aria-expanded={false} onClick={() => setOpen(true)}>
    {t("needs.title")}{items?.length ? ` · ${items.length}` : ""}</button>;
  return <section className="continue-work continue-work-float needs-you" aria-labelledby={titleId}>
    <div className="continue-heading"><h2 id={titleId}>{t("needs.title")}{items?.length ? ` · ${items.length}` : ""}</h2>
      <span className="flex items-center gap-2">
        <button type="button" className="link" aria-expanded onClick={() => setOpen(false)}>{t("common.close")}</button>
        <button type="button" className="link" onClick={() => nav({ panel: null, continueWork: true })}>{t("needs.work")}</button>
        <button type="button" className="link" onClick={() => nav({ panel: null, mission: true })}>{t("needs.mission")}</button>
      </span></div>
    {err && <p className="error" role="alert">{err}</p>}
    {!items && !err && <p className="muted" role="status">{t("needs.loading")}</p>}
    {items && !items.length && <p className="muted">{t("needs.empty")}</p>}
    {!!list.length && <ul>{list.slice(0, SHOWN).map((n) => <li key={n.ref} data-status={n.kind === "decide" ? "awaiting_approval" : n.kind === "unblock" ? "failed" : "done"}>
      <span><small className="continue-kind">{t(`needs.kind.${n.kind}`)}{n.status && <> · <OpsStatus raw={n.status} at={n.at} /></>}</small><b>{n.title}</b>{n.detail && <small>{n.detail}</small>}
        <small>{t(`needs.ask.${n.cause}`)}</small>
        {snooze?.ref === n.ref && <form onSubmit={doSnooze} className="flex gap-1">
          <input className="field flex-1 py-0.5 text-xs" autoFocus value={snooze.why} maxLength={200} onChange={(e) => setSnooze({ ref: n.ref, why: e.target.value })} aria-label={t("needs.snoozeWhy")} placeholder={t("needs.snoozeWhy")} />
          <button className="chip" disabled={!snooze.why.trim()}>{t("needs.snoozeSave")}</button></form>}</span>
      <span className="flex flex-col gap-1">
        <button type="button" className="chip" aria-label={`${label(n)}: ${n.title}`} onClick={() => openTarget(n.act.open, onOpenTask, onOpenGoal)}>{label(n)}</button>
        {snooze?.ref !== n.ref && <button type="button" className="link text-xs" aria-label={`${t("needs.snooze")}: ${n.title}`} onClick={() => setSnooze({ ref: n.ref, why: "" })}>{t("needs.snooze")}</button>}</span>
    </li>)}</ul>}
    {list.length > SHOWN && <p className="muted">{t("needs.more", { n: list.length - SHOWN })}</p>}
  </section>;
}
