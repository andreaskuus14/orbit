"use client";
import { useEffect } from "react";
import { notify, NOTIFY_KEY, parseItems, type NotifyDetail } from "@/lib/notify-pure";
import { RESOLVE_ALERT, businessReplies, signalFor, type Signal } from "@/lib/interruption-pure";

const json = async (url: string) => { const r = await fetch(url, { cache: "no-store" }); return r.ok ? r.json() : null; };
/** Observe existing read-only status endpoints. Never refresh credentials or start an agent/briefing. */
export function AlertWatch() {
  useEffect(() => {
    let stopped = false, busy = false, lastDoctor = 0;
    let stages: Record<string, string> | null = null;
    try { const x = JSON.parse(localStorage.getItem("orbit.businessReplyStages") ?? "null"); if (x && typeof x === "object" && !Array.isArray(x)) stages = x; } catch { /* first snapshot is baseline */ }
    const open = new Set<Signal>();
    try { for (const n of parseItems(localStorage.getItem(NOTIFY_KEY))) if (!n.resolved) open.add(signalFor(n)); } catch { /* in-memory observations still work */ }
    const condition = (signal: Signal, on: boolean, d: Omit<NotifyDetail, "kind" | "signal">) => {
      if (stopped) return;
      if (on && !open.has(signal)) { open.add(signal); notify({ ...d, key: `${signal}:${Date.now()}`, kind: "system", signal }); }
      if (!on) { open.delete(signal); dispatchEvent(new CustomEvent(RESOLVE_ALERT, { detail: signal })); }
    };
    const poll = async () => {
      if (busy || stopped) return;
      busy = true;
      const safe = (url: string) => json(url).catch(() => null);
      try {
        const doctorDue = Date.now() - lastDoctor >= 5 * 60_000;
        const [oauth, business, doctor] = await Promise.all([safe("/api/studio/oauth/status"), safe("/api/business"), doctorDue ? safe("/api/doctor?interruptions=1") : null]);
        if (stopped) return;
        // A disconnected/unknown status after a server restart is not proof an expired grant was fixed.
        if (oauth?.expired || oauth?.connected) condition("youtube-expired", oauth.expired === true, { title: "YouTube sign-in expired", reason: "Google rejected the saved sign-in; publishing needs you to reconnect.", fixHref: "/api/studio/oauth/start", fixLabel: "Reconnect YouTube", nav: { panel: "studio" } });
        if (doctor?.checks) {
          lastDoctor = Date.now();
          const disk = doctor.checks.find((c: { id: string }) => c.id === "disk");
          if (disk) condition("disk-full", disk.status === "fail", { title: "Disk almost full", reason: disk.detail, fixLabel: "Review old clips", nav: { panel: "studio", view: "clips" } });
        }
        if (business?.prospects) {
          const b = businessReplies(stages, business.prospects); stages = b.stages;
          try { localStorage.setItem("orbit.businessReplyStages", JSON.stringify(stages)); } catch { /* session baseline remains */ }
          b.notices.forEach(notify);
        }

      } finally { busy = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 60_000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return null;
}
