"use client";
import { useEffect } from "react";
import { beatDue } from "@/lib/usage-pace-pure";

/** Tells the ORBIT PC he is here (real input only, tab visible, at most once a minute), so background Claude work keeps headroom for him.
 *  A tab left open overnight sends nothing. Renders nothing. */
export function PresenceBeat() {
  useEffect(() => {
    let last = 0;
    const on = () => {
      const now = Date.now();
      if (!beatDue(now, last, document.visibilityState === "visible")) return;
      last = now;
      void fetch("/api/presence", { method: "POST" }).catch(() => {});
    };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart", "pointermove"] as const;
    for (const e of evs) addEventListener(e, on, { passive: true });
    return () => { for (const e of evs) removeEventListener(e, on); };
  }, []);
  return null;
}
