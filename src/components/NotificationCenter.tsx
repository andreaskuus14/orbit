"use client";
// The HUD bell: history of everything ORBIT announced (STUDIO, LIFE reminders, agents…). Emitters call notify() from notify-pure.ts.
import { useEffect, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { NOTIFY_EVENT, NOTIFY_KEY, KIND_ICON, addItem, notify, parseItems, relTime, unreadCount, type NotifyDetail, type NotifyItem } from "@/lib/notify-pure";
import type { BootResult } from "@/lib/doctor-boot-pure";
import { HeraldToggle } from "./Herald";
import { INTERRUPTION_CHANGED, INTERRUPTION_KEY, POPUP_SHOWN, RESOLVE_ALERT, LABELS, batchCount, classify, fixTarget, isProblem, reasonLine, signalFor, unmuteKind, type Signal } from "@/lib/interruption-pure";
import { loadJudgment, saveJudgment } from "./interruption-store";
import { AlertWatch } from "./AlertWatch";

let memory: NotifyItem[] = [], storageFailed = false;
const load = () => { try { if (!storageFailed) memory = parseItems(localStorage.getItem(NOTIFY_KEY)); } catch { storageFailed = true; } return memory; };
const save = (l: NotifyItem[]) => { memory = l; try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(l)); storageFailed = false; } catch { storageFailed = true; } };

export function NotificationCenter({ home = false }: { home?: boolean }) {
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [now, setNow] = useState(0);
  const [judgment, setJudgment] = useState(loadJudgment);
  const commit = (l: NotifyItem[]) => { save(l); setItems(l); };

  useEffect(() => {
    setItems(load());
    // Re-read storage on every event so several ORBIT windows don't overwrite each other's history.
    const onNotify = (e: Event) => { const l = addItem(load(), (e as CustomEvent<NotifyDetail>).detail, Date.now()); save(l); setItems(l); };
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
  const fix = (it: NotifyItem) => {
    if (it.fixHref === "/api/studio/oauth/start") { window.location.assign(it.fixHref); return; }
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: fixTarget(it) }));
  };
  const open = (it: NotifyItem) => {
    commit(load().map((x) => (x.id === it.id ? { ...x, read: true } : x))); // fresh from storage: keep what other windows added
    if (it.nav) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: it.nav }));
  };

  return (
    <>
      <AlertWatch />
      {home && problems.length > 0 && <button type="button" className="chip !border-red-500 !text-red-300" title={reasonLine(problems[0])}
        onClick={() => fix(problems[0])} aria-label={`Red alert: ${problems[0].title}. ${problems[0].fixLabel ?? "Open fix"}`}>
        🔴 Red alert{problems.length > 1 ? ` (${problems.length})` : ""} · {problems[0].fixLabel ?? "Open fix"}
      </button>}
      <button className="chip relative" popoverTarget="notify-menu" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications">
        🔔
        {unread > 0 && <span aria-hidden className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {/* Same native popover as #hud-menu: light-dismiss, Esc and top layer for free. */}
      <div id="notify-menu" popover="auto" className="glass hud-menu" style={{ width: "min(22rem, calc(100vw - 2rem))", maxHeight: "70vh" }} aria-label="Notifications"
        onToggle={() => setNow(Date.now())}>
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <strong className="text-xs tracking-[0.15em]">NOTIFICATIONS</strong>
          <span className="flex gap-1">
            <HeraldToggle />
            <button className="chip" disabled={!unread} onClick={() => commit(load().map((x) => ({ ...x, read: true })))}>Mark all read</button>
            <button className="chip" disabled={!items.length} title="Clear history; keep unresolved red alerts" onClick={() => commit(load().filter((x) => !x.resolved && isProblem(x)))}>Clear history</button>
          </span>
        </div>
        <details className="px-2 py-1 text-xs">
          <summary className="cursor-pointer">Interruption settings</summary>
          <p className="muted my-1">Dismiss the same kind twice in a week to quiet it. It stays quiet until you unmute it; red alerts remain visible.</p>
          {judgment.muted.length ? judgment.muted.map((kind) => <div key={kind} className="flex items-center justify-between gap-2 py-1">
            <span>{LABELS[kind]} · quiet</span><button className="chip" onClick={() => saveJudgment(unmuteKind(loadJudgment(), kind))}>Unmute {LABELS[kind]}</button>
          </div>) : <p className="muted">No kinds muted.</p>}
        </details>
        {updates > 0 && <p className="muted px-2 py-1 text-xs" aria-live="polite">{updates} {updates === 1 ? "update" : "updates"} · grouped in your bell</p>}
        {items.length ? (
          <ul className="flex flex-col gap-0.5 overflow-y-auto" aria-label="Notification history">
            {items.map((it) => (
              <li key={it.id}>
                <button className="hud-menu-item w-full !items-start !justify-start" popoverTarget="notify-menu" popoverTargetAction="hide" onClick={() => open(it)}
                  aria-label={`${it.read ? "" : "Unread: "}${it.title}`}>
                  <span aria-hidden>{KIND_ICON[it.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className={"block truncate " + (it.read ? "muted" : "font-semibold")}>{it.title}</span>
                    <span className="muted block text-xs">{reasonLine(it)}</span>
                    <span className="muted block text-[10px]">{classify(it, judgment)}{it.resolved ? " · Resolved" : ""}</span>
                    <span className="muted block text-[10px]">{relTime(it.at, now || it.at)}</span>
                  </span>
                  {!it.read && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-400" />}
                </button>
                {it.herald?.actions.map((a) => <button key={a.label} className="chip ml-2 text-xs" onClick={() => dispatchEvent(new CustomEvent("orbit:herald-action", { detail: { card: it.herald, action: a } }))}>{a.label}</button>)}
                {isProblem(it) && !it.resolved && <div className="flex gap-1 px-2 pb-1">
                  <button className="chip" onClick={() => fix(it)}>{it.fixLabel ?? "Open fix"}</button>
                  <button className="chip" onClick={() => commit(load().map((x) => x.id === it.id ? { ...x, resolved: true } : x))}>Mark resolved</button>
                </div>}
              </li>
            ))}
          </ul>
        ) : <p className="muted px-2 py-4 text-center text-xs">Nothing yet. Clips, reminders and agent results show up here.</p>}
      </div>
    </>
  );
}
