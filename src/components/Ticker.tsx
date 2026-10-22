"use client";
// Cockpit ticker (plan #6): the last few notifications scroll by in one thin line under the header, like a ship's log.
// Reads the bell's own history; nothing new is stored or fetched.
import { useEffect, useState } from "react";
import { NOTIFY_EVENT, NOTIFY_KEY, parseItems, relTime, type NotifyItem } from "@/lib/notify-pure";

const read = () => { try { return parseItems(localStorage.getItem(NOTIFY_KEY)).slice(0, 6); } catch { return []; } };

export function Ticker() {
  const [items, setItems] = useState<NotifyItem[]>([]), [i, setI] = useState(0);
  useEffect(() => {
    const load = () => setItems(read());
    load();
    const t = setInterval(() => setI((n) => n + 1), 6000);
    const onNotify = () => setTimeout(load, 50); // after the bell has saved it
    addEventListener(NOTIFY_EVENT, onNotify); addEventListener("storage", load);
    return () => { clearInterval(t); removeEventListener(NOTIFY_EVENT, onNotify); removeEventListener("storage", load); };
  }, []);
  if (!items.length) return null;
  const it = items[i % items.length];
  return (
    <div className="ticker" role="status" aria-label="Latest activity">
      <span className="ticker-dot" aria-hidden />
      <span key={it.id} className="ticker-line"><b>{it.title}</b>{it.reason ? ` · ${it.reason}` : ""} <span className="muted">· {relTime(it.at, Date.now())}</span></span>
    </div>
  );
}
