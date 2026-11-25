"use client";
// The HUD bell: history of everything ORBIT announced (STUDIO, LIFE reminders, agents…). Emitters call notify() from notify-pure.ts.
import { useEffect, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { sfx } from "./sfx";
import { NOTIFY_EVENT, NOTIFY_KEY, KIND_ICON, addItem, notify, parseItems, relTime, unreadCount, type NotifyDetail, type NotifyItem } from "@/lib/notify-pure";
import type { BootResult } from "@/lib/doctor-boot-pure";
import { HeraldToggle } from "./Herald";
import { INTERRUPTION_CHANGED, INTERRUPTION_KEY, POPUP_SHOWN, RESOLVE_ALERT, LABELS, batchCount, classify, fixTarget, isProblem, reasonLine, signalFor, unmuteKind, type Signal } from "@/lib/interruption-pure";
import { loadJudgment, saveJudgment } from "./interruption-store";
import { AlertWatch } from "./AlertWatch";
import { OPEN_EVENT, openedToday, useReady, useWanting } from "./startup-store";
import { pillOf, type Ready } from "@/lib/startup-pure";
import { useT } from "./i18n";
import { StudioNotifier } from "./StudioNotifier";

let memory: NotifyItem[] = [], storageFailed = false;
const load = () => { try { if (!storageFailed) memory = parseItems(localStorage.getItem(NOTIFY_KEY)); } catch { storageFailed = true; } return memory; };
const save = (l: NotifyItem[]) => { memory = l; try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(l)); storageFailed = false; } catch { storageFailed = true; } };

/** The top-bar problem chip names the problem itself (≤ 32 characters, "STUDIO: " prefixes dropped). */
const shortTitle = (t: string) => { const x = t.replace(/^[A-Z]{3,}:\s*/, ""); return x.length > 32 ? `${x.slice(0, 31).trimEnd()}…` : x; };

export function NotificationCenter({ home = false }: { home?: boolean }) {
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [now, setNow] = useState(0);
  const [judgment, setJudgment] = useState(loadJudgment);
  const commit = (l: NotifyItem[]) => { save(l); setItems(l); };
  const { t } = useT();
  const ready = useReady();
  const [sameDay, setSameDay] = useState(true); // client only: a same-day reopen gets no "new" dot
  useEffect(() => setSameDay(openedToday()), []);

  useEffect(() => {
    setItems(load());
    // Re-read storage on every event so several ORBIT windows don't overwrite each other's history.
    const onNotify = (e: Event) => { const before = load(), l = addItem(before, (e as CustomEvent<NotifyDetail>).detail, Date.now()); if (l.length !== before.length || l[0]?.key !== before[0]?.key) sfx.chime(); save(l); setItems(l); }; // chime only for a new item, not a repeat
    const onStorage = (e: StorageEvent) => { if (e.key === NOTIFY_KEY) setItems(load()); if (e.key === INTERRUPTION_KEY) setJudgment(loadJudgment()); };
    const onJudgment = () => setJudgment(loadJudgment());
    const onShown = (e: Event) => { const keys = (e as CustomEvent<string[]>).detail; const l = load().map((x) => keys.includes(x.key ?? `n:${x.kind}:${x.title}|${x.body ?? ""}`) ? { ...x, interrupted: true } : x); save(l); setItems(l); };
    const onResolve = (e: Event) => { const signal = (e as CustomEvent<Signal>).detail; const l = load().map((x) => signalFor(x) === signal ? { ...x, resolved: true } : x); save(l); setItems(l); };
    addEventListener(RESOLVE_ALERT, onResolve); addEventListener(INTERRUPTION_CHANGED, onJudgment);
    addEventListener(POPUP_SHOWN, onShown);
    addEventListener(NOTIFY_EVENT, onNotify);
    addEventListener("storage", onStorage);
    // Once per server boot: the self-test's notice (crash since last boot or a failing check), remembered so reloads don't repeat it.
    void fetch("/api/doctor?boot=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b: BootResult | null) => {
      try {
        if (!b?.notice || localStorage.getItem("orbit.bootSeen") === b.bootId) return;
        localStorage.setItem("orbit.bootSeen", b.bootId);
      } catch { return; }
      notify(b.notice);
    }).catch(() => { /* server down or signed out: nothing to announce */ });
    return () => { removeEventListener(POPUP_SHOWN, onShown); removeEventListener(RESOLVE_ALERT, onResolve); removeEventListener(INTERRUPTION_CHANGED, onJudgment); removeEventListener(NOTIFY_EVENT, onNotify); removeEventListener("storage", onStorage); };
  }, []);

  const unread = unreadCount(items), updates = batchCount(items, judgment);
  const problems = items.filter((x) => !x.resolved && isProblem(x));
  const kinds = new Set(problems.map(signalFor)).size; // one cause, one count (e.g. many STUDIO failures = 1)
  const toastUp = useWanting().includes("alert"); // an urgent Herald card is saying it right now: the chip waits (startup-pure)
  const fix = (it: NotifyItem) => {
    if (it.fixHref === "/api/studio/oauth/start") { window.location.assign(it.fixHref); return; }
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: fixTarget(it) }));
  };
  // Quiet open: morning brief, What's new, digests and non-urgent notices wait in this one pill (startup-pure pillOf).
  const pill = pillOf(ready, updates, kinds, sameDay);
  const label = pill && [pill.lead ? t(`quiet.${pill.lead}`) : pill.tour ? t("quiet.tour") : "", pill.fresh ? t("quiet.new", { n: pill.fresh }) : "",
    pill.needYou ? t("quiet.needYou", { n: pill.needYou }) : ""].filter(Boolean).join(" · ");
  const openReady = (r: Ready) => dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: r }));
  const bell = () => { try { document.getElementById("notify-menu")?.showPopover(); } catch { /* already open */ } };
  const open = (it: NotifyItem) => {
    commit(load().map((x) => (x.id === it.id ? { ...x, read: true } : x))); // fresh from storage: keep what other windows added
    if (it.nav) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: it.nav }));
  };

  return (
    <>
      <AlertWatch />
      {home && problems.length > 0 && !toastUp && <button type="button" className="chip hud-alert !border-red-500 !text-red-300" title={reasonLine(problems[0])}
        onClick={() => fix(problems[0])} aria-label={`Problem: ${problems[0].title}. ${problems[0].fixLabel ?? "Open fix"}`}>
        <span aria-hidden className="hud-alert-dot" /><span className="alert-label"> {/* what broke, not the button's verb ("Problem · Review failure" said nothing, 22 Nov) */}
          {shortTitle(problems[0].title)}</span>{kinds > 1 && <span className="alert-count">{kinds}</span>}
      </button>}
      {home && pill && <>
        <button type="button" className="chip quiet-pill relative" popoverTarget="quiet-menu" aria-label={t("quiet.aria", { s: label ?? "" })}>
          {problems.length > 0 && !toastUp && <span aria-hidden className="quiet-alert hud-alert-dot" />}
          {label}{pill.dot && <span aria-hidden className="quiet-dot" />}
        </button>
        <div id="quiet-menu" popover="auto" className="glass hud-menu quiet-menu" aria-label={t("quiet.title")}>
          {ready.map((r) => <button key={r} className="hud-menu-item w-full" popoverTarget="quiet-menu" popoverTargetAction="hide" onClick={() => openReady(r)}>
            {t(`quiet.${r}`)}{r === "tour" && <span className="quiet-new">{t("quiet.dot")}</span>}
          </button>)}
          {pill.fresh > 0 && <button className="hud-menu-item w-full" popoverTarget="quiet-menu" popoverTargetAction="hide" onClick={bell}>🔔 {t("quiet.new", { n: pill.fresh })}</button>}
          {pill.needYou > 0 && <button className="hud-menu-item w-full" popoverTarget="quiet-menu" popoverTargetAction="hide" onClick={() => fix(problems[0])}>🔴 {t("quiet.needYou", { n: pill.needYou })}</button>}
        </div>
      </>}
      <button className="chip hud-bell relative" popoverTarget="notify-menu" aria-label={unread ? t("notify.ariaUnread", { n: unread }) : t("notify.title")} title={t("notify.title")}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3zM6.5 14h3" /></svg>
        {unread > 0 && <span aria-hidden className="hud-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {/* Same native popover as #hud-menu: light-dismiss, Esc and top layer for free. */}
      <div id="notify-menu" popover="auto" className="glass hud-menu" style={{ width: "min(22rem, calc(100vw - 2rem))", maxHeight: "70vh" }} aria-label={t("notify.title")}
        onToggle={() => setNow(Date.now())}>
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <strong className="notify-head">{t("notify.title")}</strong>
          <span className="flex gap-1">
            <HeraldToggle />
            <button className="chip" disabled={!unread} onClick={() => commit(load().map((x) => ({ ...x, read: true })))}>{t("notify.markRead")}</button>
            <button className="chip" disabled={!items.length} title={t("notify.clearTitle")} onClick={() => commit(load().filter((x) => !x.resolved && isProblem(x)))}>{t("notify.clear")}</button>
          </span>
        </div>
        <StudioNotifier inMenu />
        <details className="px-2 py-1 text-xs">
          <summary className="cursor-pointer">{t("notify.settings")}</summary>
          <p className="muted my-1">{t("notify.muteHelp")}</p>
          {judgment.muted.length ? judgment.muted.map((kind) => <div key={kind} className="flex items-center justify-between gap-2 py-1">
            <span>{LABELS[kind]} · {t("notify.quiet")}</span><button className="chip" onClick={() => saveJudgment(unmuteKind(loadJudgment(), kind))}>{t("notify.unmute", { kind: LABELS[kind] })}</button>
          </div>) : <p className="muted">{t("notify.noneMuted")}</p>}
        </details>
        {updates > 0 && <p className="muted px-2 py-1 text-xs" aria-live="polite">{t(updates === 1 ? "notify.updates.one" : "notify.updates.other", { n: updates })}</p>}
        {items.length ? (
          <ul className="flex flex-col gap-0.5 overflow-y-auto" aria-label={t("notify.history")}>
            {items.map((it) => (
              <li key={it.id}>
                <button className="hud-menu-item w-full !items-start !justify-start" popoverTarget="notify-menu" popoverTargetAction="hide" onClick={() => open(it)}
                  aria-label={it.read ? it.title : t("notify.unread", { title: it.title })}>
                  <span aria-hidden>{KIND_ICON[it.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className={"block truncate " + (it.read ? "muted" : "font-semibold")}>{it.title}</span>
                    <span className="muted block text-xs">{reasonLine(it)}</span>
                    <span className="muted block text-[10px]">{classify(it, judgment)}{it.resolved ? ` · ${t("notify.resolved")}` : ""}</span>
                    <span className="muted block text-[10px]">{relTime(it.at, now || it.at)}</span>
                  </span>
                  {!it.read && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-400" />}
                </button>
                {it.herald?.actions.map((a) => <button key={a.label} className="chip ml-2 text-xs" onClick={() => dispatchEvent(new CustomEvent("orbit:herald-action", { detail: { card: it.herald, action: a } }))}>{a.label}</button>)}
                {isProblem(it) && !it.resolved && <div className="flex gap-1 px-2 pb-1">
                  <button className="chip" onClick={() => fix(it)}>{it.fixLabel ?? t("notify.openFix")}</button>
                  <button className="chip" onClick={() => commit(load().map((x) => x.id === it.id ? { ...x, resolved: true } : x))}>{t("notify.markResolved")}</button>
                </div>}
              </li>
            ))}
          </ul>
        ) : <p className="muted px-2 py-4 text-center text-xs">{t("notify.empty")}</p>}
      </div>
    </>
  );
}

/** Phones: the top bar has no room for the status pill ("What'" was all that showed), so its items live in the "…" menu instead. */
export function PhoneReadyItems() {
  const { t } = useT();
  const ready = useReady();
  return <>{ready.map((r) => <button key={r} className="hud-menu-item hud-menu-phone" popoverTarget="hud-menu" popoverTargetAction="hide"
    onClick={() => dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: r }))}>{t(`quiet.${r}`)}{r === "tour" && <span className="quiet-new">{t("quiet.dot")}</span>}</button>)}</>;
}
