"use client";
import { useEffect } from "react";
import type { Reminder } from "@/lib/life-pure";
import { notify } from "@/lib/notify-pure";
import { translate } from "@/lib/i18n-pure";
import { getLang } from "./i18n";

// Global reminder poller: claims each due occurrence, then sends it to the shared bell/Herald judgment.
// Signed out (401) → quiet for 5 minutes. No separate toast bypass.

export default function LifeReminders() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      let wait = 30_000;
      try {
        const res = await fetch("/api/life?due=1");
        if (res.status === 401) wait = 300_000;
        else if (res.ok) {
          const { due, habits } = (await res.json()) as { due: Reminder[]; habits?: { id: string; name: string; emoji: string; at: number }[] };
          const lang = getLang();
          for (const h of habits ?? []) // habit engine: already claimed server side (habit-nudge.ts), one window gets each
            notify({ key: `habit:${h.id}:${h.at}`, signal: "reminder", reason: translate(lang, "habit.toastReason", { name: h.name }), title: translate(lang, "habit.time"), body: `${h.emoji} ${h.name}`.trim(), kind: "life", nav: { panel: "life" } });
          for (const r of due ?? []) {
            // Mark fired first: if that fails we try again next poll instead of showing it twice.
            const ok = await fetch("/api/life", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fired", id: r.id }) })
              .then(async (x) => x.ok && (await x.json()).ok === true).catch(() => false); // false: another ORBIT window already showed it
            if (!ok || !alive) continue;
            notify({ key: `reminder:${r.id}:${r.at}`, signal: "reminder", reason: `Your reminder is due: ${r.text}`, title: "Reminder", body: r.text, kind: "life", nav: { panel: "life" } });
          }
        }
      } catch { /* offline: try again later */ }
      if (alive) timer = setTimeout(poll, wait);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return null;
}
