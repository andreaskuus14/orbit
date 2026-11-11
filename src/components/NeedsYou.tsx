"use client";
// "Needs you": the home HUD's main card. One deduplicated list (needs-you-pure) of decisions, blockers and finished results, each
// with one action: open it where it is handled (Decide → "Review": the exact content and its Approve, never a one-tap approve here). Polls /api/needs-you every 60 s while visible. Continue my work and Mission control stay one tap away.
import { useCallback, useId, useMemo, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { MARKETS_TAB, type BriefOpen } from "@/lib/brief-pure";
import { groupNeeds, type Digest, type Need } from "@/lib/needs-you-pure";
import { useT } from "./i18n";
import { OpsStatus } from "./OpsStatus";
import { GalaxyActivityRail } from "./GalaxyActivityRail";
import styles from "./GalaxyActivityRail.module.css";

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
  else if ("tab" in o) { try { sessionStorage.setItem(MARKETS_TAB, o.tab); } catch { /* opens on Watchlist */ } nav({ panel: o.panel }); }
  else nav({ panel: o.panel, ...(o.view && { view: o.view }) });
}

export type GalaxyTasks = { running: { id: string; title: string } | null; latest: { id: string; title: string } | null };
export function NeedsYou({ onOpenTask, onOpenGoal, tasks, tasksFailed, inline = false }: {
  onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void;
  tasks: GalaxyTasks | null; tasksFailed: boolean; inline?: boolean;
}) {
  const { t, lang } = useT();
  const titleId = useId();
  const [items, setItems] = useState<Need[] | null>(null);
  const [err, setErr] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [snooze, setSnooze] = useState<{ ref: string; why: string } | null>(null);
  const [open, setOpen] = useState(false); // quiet open (#352): the galaxy stays uncovered; the count waits in a chip until clicked
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
      .then((r) => { if (!r.ok) throw new Error(); setItems((l) => l?.filter((x) => x.ref !== ref) ?? l); setSnooze(null); })
      .catch(() => setErr(t("needs.snoozeFailed")));
  };
  const label = (n: Need) => t(n.kind === "decide" ? "needs.review" : "common.open"); // Decide opens the exact content and its Approve
  const list = useMemo(() => groupNeeds(items ?? []), [items]); // similar approvals (22 Shorts from one video) → one card

  const attention = items?.find((item) => item.kind === "decide" || item.kind === "unblock");
  const taskEntry = (task: GalaxyTasks["running"]) => task && { title: task.title, open: () => onOpenTask(task.id) };
  const taskState = tasksFailed ? (tasks ? "stale" : "unavailable") : tasks ? "fresh" : "loading";
  const attentionState = loadFailed ? (items ? "stale" : "unavailable") : items ? "fresh" : "loading";
  if (!open) return <GalaxyActivityRail inline={inline} onMore={() => setOpen(true)} slots={[
    { entry: taskEntry(tasks?.running ?? null), state: taskState },
    { entry: attention ? { title: attention.title, open: () => openTarget(attention.act.open, onOpenTask, onOpenGoal) } : null, state: attentionState },
    { entry: taskEntry(tasks?.latest ?? null), state: taskState },
  ]} />;
  return <section className={inline ? "continue-work needs-you" : `continue-work needs-you ${styles.detail}`} aria-labelledby={titleId}>
    <div className="continue-heading"><h2 id={titleId}>{t("needs.title")}{items?.length ? ` · ${items.length}` : ""}</h2>
      <span className="flex items-center gap-2">
        <button type="button" className="link" aria-expanded onClick={() => setOpen(false)}>{t("common.close")}</button>
        <button type="button" className="link" onClick={() => nav({ panel: null, continueWork: true })}>{t("needs.work")}</button>
        <button type="button" className="link" onClick={() => nav({ panel: null, mission: true })}>{t("needs.mission")}</button>
      </span></div>
    {(err || loadFailed) && <p className="error" role="alert">{err || t("needs.loadFailed")}</p>}
    {digest && <ul className="muted text-xs" aria-label="Digest">{digest.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    {!items && !err && !loadFailed && <p className="muted" role="status">{t("needs.loading")}</p>}
    {items && !loadFailed && !items.length && <p className="muted">{t("needs.empty")}</p>}
    {!!list.length && <ul>{list.slice(0, SHOWN).map((n) => <li key={n.ref} data-status={n.kind === "decide" ? "awaiting_approval" : n.kind === "unblock" ? "failed" : "done"}>
      <span><small className="continue-kind">{t(`needs.kind.${n.kind}`)}{n.status && <> · <OpsStatus raw={n.status} at={n.at} /></>}</small><b>{n.title}{n.group && ` · ${n.group.length}`}</b>{n.detail && <small>{n.detail}</small>}
        <small>{t(`needs.ask.${n.cause}`)}</small>
        {n.group && <button type="button" className="link text-xs" aria-expanded={expanded === n.ref} onClick={() => setExpanded(expanded === n.ref ? null : n.ref)}>{t(expanded === n.ref ? "needs.groupHide" : "needs.groupShow", { n: n.group.length })}</button>}
        {n.group && expanded === n.ref && <ul aria-label={n.title}>{n.group.map((g) => <li key={g.ref}><span>{g.title}</span>
          <button type="button" className="chip" aria-label={`${label(g)}: ${g.title}`} onClick={() => openTarget(g.act.open, onOpenTask, onOpenGoal)}>{label(g)}</button></li>)}</ul>}
        {snooze?.ref === n.ref && <form onSubmit={doSnooze} className="flex gap-1">
          <input className="field flex-1 py-0.5 text-xs" autoFocus value={snooze.why} maxLength={200} onChange={(e) => setSnooze({ ref: n.ref, why: e.target.value })} aria-label={t("needs.snoozeWhy")} placeholder={t("needs.snoozeWhy")} />
          <button className="chip" disabled={!snooze.why.trim()}>{t("needs.snoozeSave")}</button></form>}</span>
      <span className="flex flex-col gap-1">
        <button type="button" className="chip" aria-label={`${n.group ? t("needs.reviewAll") : label(n)}: ${n.title}`} onClick={() => openTarget(n.act.open, onOpenTask, onOpenGoal)}>{n.group ? t("needs.reviewAll") : label(n)}</button>
        {snooze?.ref !== n.ref && !n.group && <button type="button" className="link text-xs" aria-label={`${t("needs.snooze")}: ${n.title}`} onClick={() => setSnooze({ ref: n.ref, why: "" })}>{t("needs.snooze")}</button>}</span>
    </li>)}</ul>}
    {list.length > SHOWN && <p className="muted">{t("needs.more", { n: list.length - SHOWN })}</p>}
  </section>;
}
