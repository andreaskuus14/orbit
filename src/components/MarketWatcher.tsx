"use client";
import { useEffect } from "react";
import { notify } from "@/lib/notify-pure";

// Global market-alert poller: every 5 min (paused while the tab is hidden) POSTs { action: "alerts" } to /api/markets. The server checks
// the rules against cached quotes, marks fired ones (once per rule per day) and runs the daily paper-bot step.
// Signed out (401) → quiet for 30 minutes.

type Fired = { id: string; ticker: string; text: string };
const EVERY = 5 * 60_000;

export default function MarketWatcher() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, alive = true, last = 0, quietUntil = 0;
    const poll = async () => {
      clearTimeout(timer);
      if (document.hidden || Date.now() < quietUntil) { if (alive) timer = setTimeout(poll, EVERY); return; }
      last = Date.now();
      try {
        const res = await fetch("/api/markets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "alerts" }) });
        if (res.status === 401 || res.status === 403) quietUntil = Date.now() + 30 * 60_000;
        else if (res.ok) {
          const { fired } = (await res.json()) as { fired?: Fired[] };
          for (const f of fired ?? []) {
            if (!alive) break;
            notify({ signal: "routine", reason: f.text, title: `Market alert: ${f.ticker}`, body: f.text, kind: "system", nav: { panel: "markets" } });
          }
        }
      } catch { /* offline: try again later */ }
      if (alive) timer = setTimeout(poll, EVERY);
    };
    const onVisible = () => { if (!document.hidden && Date.now() - last >= EVERY) void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(poll, 15_000); // let the app settle first
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return null;
}
