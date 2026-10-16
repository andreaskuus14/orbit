"use client";
// The HUD bell: history of everything ORBIT announced (STUDIO, LIFE reminders, agents…). Emitters call notify() from notify-pure.ts.
import { useEffect, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { NOTIFY_EVENT, NOTIFY_KEY, KIND_ICON, addItem, parseItems, relTime, unreadCount, type NotifyDetail, type NotifyItem } from "@/lib/notify-pure";

const load = () => { try { return parseItems(localStorage.getItem(NOTIFY_KEY)); } catch { return []; } };
const save = (l: NotifyItem[]) => { try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(l)); } catch { /* storage unavailable: history lives until reload */ } };

export function NotificationCenter() {
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [now, setNow] = useState(0);
  const commit = (l: NotifyItem[]) => { save(l); setItems(l); };

  useEffect(() => {
    setItems(load());
    // Re-read storage on every event so several ORBIT windows don't overwrite each other's history.
    const onNotify = (e: Event) => { const l = addItem(load(), (e as CustomEvent<NotifyDetail>).detail, Date.now()); save(l); setItems(l); };
    const onStorage = (e: StorageEvent) => { if (e.key === NOTIFY_KEY) setItems(load()); };
    addEventListener(NOTIFY_EVENT, onNotify);
    addEventListener("storage", onStorage);
    return () => { removeEventListener(NOTIFY_EVENT, onNotify); removeEventListener("storage", onStorage); };
  }, []);

  const unread = unreadCount(items);
  const open = (it: NotifyItem) => {
    commit(load().map((x) => (x.id === it.id ? { ...x, read: true } : x))); // fresh from storage: keep what other windows added
    if (it.nav) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: it.nav }));
  };

  return (
    <>
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
            <button className="chip" disabled={!unread} onClick={() => commit(load().map((x) => ({ ...x, read: true })))}>Mark all read</button>
            <button className="chip" disabled={!items.length} onClick={() => commit([])}>Clear</button>
          </span>
        </div>
        {items.length ? (
          <ul className="flex flex-col gap-0.5 overflow-y-auto" aria-label="Notification history">
            {items.map((it) => (
              <li key={it.id}>
                <button className="hud-menu-item w-full !items-start !justify-start" popoverTarget="notify-menu" popoverTargetAction="hide" onClick={() => open(it)}
                  aria-label={`${it.read ? "" : "Unread: "}${it.title}`}>
                  <span aria-hidden>{KIND_ICON[it.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className={"block truncate " + (it.read ? "muted" : "font-semibold")}>{it.title}</span>
                    {it.body && <span className="muted block truncate text-xs">{it.body}</span>}
                    <span className="muted block text-[10px]">{relTime(it.at, now || it.at)}</span>
                  </span>
                  {!it.read && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-400" />}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted px-2 py-4 text-center text-xs">Nothing yet. Clips, reminders and agent results show up here.</p>}
      </div>
    </>
  );
}
