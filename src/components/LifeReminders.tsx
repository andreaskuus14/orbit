"use client";
import { useEffect, useState } from "react";
import type { Reminder } from "@/lib/life-pure";
import { notify } from "@/lib/notify-pure";

// Global reminder poller: every 30 s asks /api/life?due=1, shows a toast (and a system notification if allowed),
// then marks each one fired so it shows once. Signed out (401) → quiet for 5 minutes.

export default function LifeReminders() {
  const [toasts, setToasts] = useState<Reminder[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      let wait = 30_000;
      try {
        const res = await fetch("/api/life?due=1");
        if (res.status === 401) wait = 300_000;
        else if (res.ok) {
          const { due } = (await res.json()) as { due: Reminder[] };
          for (const r of due ?? []) {
            // Mark fired first: if that fails we try again next poll instead of showing it twice.
            const ok = await fetch("/api/life", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fired", id: r.id }) })
              .then(async (x) => x.ok && (await x.json()).ok === true).catch(() => false); // false: another ORBIT window already showed it
            if (!ok || !alive) continue;
            setToasts((t) => (t.some((x) => x.id === r.id && x.at === r.at) ? t : [...t, r])); // a repeating one keeps its id
            notify({ title: "Reminder", body: r.text, kind: "life", nav: { panel: "life" } });
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try { new Notification("ORBIT reminder", { body: r.text, tag: r.id }); } catch { /* ignore */ }
            }
          }
        }
      } catch { /* offline: try again later */ }
      if (alive) timer = setTimeout(poll, wait);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-xs flex-col gap-2">
      {toasts.map((r) => (
        <div key={`${r.id}@${r.at}`} role="status" className="card flex items-start gap-2 text-sm">
          <span className="flex-1">⏰ {r.text}</span>
          <button className="chip" onClick={() => setToasts((t) => t.filter((x) => x !== r))}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
