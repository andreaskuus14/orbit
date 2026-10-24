"use client";
// Reports long frames (>150 ms) with script attribution and galaxy context to /api/perf, so a freeze in the owner's
// own window can be diagnosed. Cheap: an observer plus one POST every 5 s only when something was slow.
import { useEffect } from "react";

type Ctx = Record<string, unknown>;
export const perfCtx: Ctx = {}; // the galaxy writes its state here (level, stop, selected, size)

export function PerfBeacon() {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) return;
    const q: unknown[] = [];
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { blockingDuration: number; renderStart: number; styleAndLayoutStart: number; scripts: { duration: number; invoker: string; invokerType: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition: number }[] })[]) {
        if (e.duration < 150) continue;
        q.push({
          at: Math.round(e.startTime), ms: Math.round(e.duration),
          render: e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : 0,
          scripts: e.scripts.slice(0, 4).map((s) => ({ ms: Math.round(s.duration), fn: s.sourceFunctionName, src: (s.sourceURL || "").split("/").pop(), pos: s.sourceCharPosition, via: `${s.invokerType} ${String(s.invoker).slice(0, 40)}` })),
          ctx: { ...perfCtx, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vis: document.visibilityState },
        });
      }
    });
    po.observe({ type: "long-animation-frame", buffered: true });
    const t = setInterval(() => {
      if (!q.length) return;
      void fetch("/api/perf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: q.splice(0) }) }).catch(() => {});
    }, 5000);
    return () => { po.disconnect(); clearInterval(t); };
  }, []);
  return null;
}
