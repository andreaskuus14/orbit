"use client";
// "Needs you": the home HUD's main card. One deduplicated list (needs-you-pure) of decisions, blockers and finished results, each
// with one action: open it where it is handled (Decide → "Review": the exact content and its Approve, never a one-tap approve here). Polls /api/needs-you every 60 s while visible. Continue my work and Mission control stay one tap away.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { dropFresh, usePoll } from "./use-poll";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import type { BriefOpen } from "@/lib/brief-pure";
import { groupNeeds, type Digest, type Need } from "@/lib/needs-you-pure";
import { useT } from "./i18n";
import { OpsStatus } from "./OpsStatus";
import { GalaxyActivityRail } from "./GalaxyActivityRail";
import styles from "./GalaxyActivityRail.module.css";
import { fromNeed, type Progress } from "@/lib/progress-pure";
import { ProgressCard } from "./ProgressCard";

const SHOWN = 5;
const nav = (detail: NavTarget) => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail }));

/** Go where a brief / inbox item points (shared with MorningBriefBody). */
export function openTarget(o: BriefOpen, onOpenTask: (id: string) => void, onOpenGoal: (id: string) => void) {
  if ("href" in o) window.open(o.href, "_blank", "noopener,noreferrer");
  else if ("link" in o) location.hash = o.link; // Orbit applies the deep link on popstate (planet, view, record)
  else if ("task" in o) onOpenTask(o.task);
  else if ("goal" in o) onOpenGoal(o.goal);
  else if ("work" in o) (o.work.kind === "task" ? onOpenTask : onOpenGoal)(o.work.id);
  else if ("memory" in o) dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: o.memory } }));
  else if ("study" in o) nav({ panel: "memory", study: true });
  else if ("mission" in o) nav({ panel: null, mission: true });
  else if ("doctor" in o) nav({ panel: null, doctor: true });
  else nav({ panel: o.panel, ...(o.view && { view: o.view }) });
}

export type GalaxyTasks = { running: { id: string; title: string } | null; latest: { id: string; title: string } | null };
/** open/onClose: controlled by the home desk (the inbox only, no rail). Without them: the old rail that opens into the inbox. */
export function NeedsYou({ onOpenTask, onOpenGoal, tasks = null, tasksFailed = false, inline = false, open: shownOpen, onClose, extra = [] }: {
  onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void;
  tasks?: GalaxyTasks | null; tasksFailed?: boolean; inline?: boolean; open?: boolean; onClose?: () => void;
  extra?: Progress[]; // task cards waiting for him (home desk); shown first unless the inbox already lists that task
}) {
  const { t, lang } = useT();
  const titleId = useId();
  const [items, setItems] = useState<Need[] | null>(null);
  const [err, setErr] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [snooze, setSnooze] = useState<{ ref: string; why: string } | null>(null);
  const [openSelf, setOpenSelf] = useState(false); // quiet open (#352): the galaxy stays uncovered; the count waits in a chip until clicked
  const focusOnMount = useRef<"close" | "more" | null>(null);
  const focusClose = useCallback((button: HTMLButtonElement | null) => {
    if (button && focusOnMount.current === "close") {
      focusOnMount.current = null;
      button.focus();
    }
  }, []);
  const focusMore = useCallback((button: HTMLButtonElement | null) => {
    if (button && focusOnMount.current === "more") {
      focusOnMount.current = null;
      button.focus();
    }
  }, []);
  const focusFirst = useCallback((button: HTMLButtonElement | null) => { button?.focus(); }, []); // the inbox opened from the home desk
  const [digest, setDigest] = useState<Digest | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null); // the group card showing its items
  // When he was last here, read once before MorningCard moves it forward (orbit.lastSeen, ms epoch).
  const [since] = useState(() => { try { return Number(localStorage.getItem("orbit.lastSeen")) || 0; } catch { return 0; } });

  const load = useCallback(() => fetch(`/api/needs-you?lang=${lang}${since ? `&since=${since}` : ""}`, { cache: "no-store" }).then((r) => r.json())
    .then((j: { items?: Need[]; digest?: Digest | null; error?: string }) => { if (!j.items) throw new Error(j.error); setItems(j.items); setDigest(j.digest ?? null); setLoadFailed(false); })
    .catch(() => setLoadFailed(true)), [lang, since]);
  const poll = useCallback(() => void load(), [load]);
  usePoll(poll, pollMs(60_000));

  const doSnooze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!snooze?.why.trim()) return;
    const ref = snooze.ref;
    fetch("/api/needs-you", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snooze: ref, reason: snooze.why.trim() }) })
      .then((r) => { if (!r.ok) throw new Error(); dropFresh(); setItems((l) => l?.filter((x) => x.ref !== ref) ?? l); setSnooze(null); })
      .catch(() => setErr(t("needs.snoozeFailed")));
  };
  const label = (n: Need) => t(n.kind === "decide" ? "needs.review" : "common.open"); // Decide opens the exact content and its Approve
  const list = useMemo(() => groupNeeds(items ?? []), [items]); // similar approvals (22 Shorts from one video) → one card

  const attention = items?.find((item) => item.kind === "decide" || item.kind === "unblock");
  const taskEntry = (task: GalaxyTasks["running"]) => task && { title: task.title, open: () => onOpenTask(task.id) };
  const taskState = tasksFailed ? (tasks ? "stale" : "unavailable") : tasks ? "fresh" : "loading";
  const attentionState = loadFailed ? (items ? "stale" : "unavailable") : items ? "fresh" : "loading";
  const controlled = shownOpen !== undefined;
  const open = controlled ? shownOpen : openSelf;
  const setOpen = (v: boolean) => { if (controlled) { if (!v) onClose?.(); } else setOpenSelf(v); };
  if (controlled && !open) return null;
  if (!open) return <GalaxyActivityRail inline={inline} moreRef={focusMore} onMore={() => { focusOnMount.current = "close"; setOpen(true); }} slots={[
    { entry: taskEntry(tasks?.running ?? null), state: taskState },
    { entry: attention ? { title: attention.title, open: () => openTarget(attention.act.open, onOpenTask, onOpenGoal) } : null, state: attentionState },
    { entry: taskEntry(tasks?.latest ?? null), state: taskState },
  ]} />;
  return <section className={controlled ? "glass needs-inbox" : inline ? `continue-work needs-you ${styles.inlineDetail}` : `continue-work needs-you ${styles.detail}`} aria-labelledby={titleId}
    onKeyDown={controlled ? (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } } : undefined}>
    <div className="continue-heading"><h2 id={titleId}>{t("needs.title")}{items?.length ? ` · ${items.length}` : ""}</h2>
      <span className="flex items-center gap-2">
        <button type="button" className="link" ref={controlled ? focusFirst : focusClose} aria-expanded onClick={() => { focusOnMount.current = "more"; setOpen(false); }}>{t("common.close")}</button>
        <button type="button" className="link" onClick={() => nav({ panel: null, continueWork: true })}>{t("needs.work")}</button>
        {!controlled && <button type="button" className="link" onClick={() => nav({ panel: null, mission: true })}>{t("needs.mission")}</button>}
      </span></div>
    {(err || loadFailed) && <p className="error" role="alert">{err || t("needs.loadFailed")}</p>}
    {controlled && (() => { const own = extra.filter((p) => !(items ?? []).some((n) => n.ref.includes(p.id))); return own.length ? <ul className="mb-2 space-y-2">{own.map((p) => <li key={p.id} className="!block !border-0 !p-0"><ProgressCard p={p} onAction={() => onOpenTask(p.id)} onOpen={() => onOpenTask(p.id)} /></li>)}</ul> : null; })()}
    {digest && !(controlled && !list.length) && <ul className="muted text-xs" aria-label={t("ny.digest")}>{digest.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    {!items && !err && !loadFailed && <p className="muted" role="status">{t("needs.loading")}</p>}
    {items && !loadFailed && !items.length && !(controlled && extra.length) && <p className="muted">{t("needs.empty")}</p>}
    {!!list.length && <ul className="space-y-2">{list.slice(0, SHOWN).map((n) => <li key={n.ref} className="!block !border-0 !p-0">
      <ProgressCard p={fromNeed(n, t(`needs.ask.${n.cause}`), n.group ? t("needs.reviewAll") : label(n))} onAction={() => openTarget(n.act.open, onOpenTask, onOpenGoal)} />
      <span className="mt-1 flex flex-wrap items-center gap-2 px-1">
        {n.status && <small className="muted"><OpsStatus raw={n.status} at={n.at} /></small>}
        {n.group && <button type="button" className="link text-xs" aria-expanded={expanded === n.ref} onClick={() => setExpanded(expanded === n.ref ? null : n.ref)}>{t(expanded === n.ref ? "needs.groupHide" : "needs.groupShow", { n: n.group.length })}</button>}
        {snooze?.ref !== n.ref && !n.group && <button type="button" className="link text-xs" aria-label={`${t("needs.snooze")}: ${n.title}`} onClick={() => setSnooze({ ref: n.ref, why: "" })}>{t("needs.snooze")}</button>}
      </span>
      {n.group && expanded === n.ref && <ul aria-label={n.title}>{n.group.map((g) => <li key={g.ref}><span>{g.title}</span>
        <button type="button" className="chip" aria-label={`${label(g)}: ${g.title}`} onClick={() => openTarget(g.act.open, onOpenTask, onOpenGoal)}>{label(g)}</button></li>)}</ul>}
      {snooze?.ref === n.ref && <form onSubmit={doSnooze} className="mt-1 flex gap-1">
        <input className="field flex-1 py-0.5 text-xs" autoFocus value={snooze.why} maxLength={200} onChange={(e) => setSnooze({ ref: n.ref, why: e.target.value })} aria-label={t("needs.snoozeWhy")} placeholder={t("needs.snoozeWhy")} />
        <button className="chip" disabled={!snooze.why.trim()}>{t("needs.snoozeSave")}</button></form>}
    </li>)}</ul>}
    {list.length > SHOWN && <p className="muted">{t("needs.more", { n: list.length - SHOWN })}</p>}
  </section>;
}
