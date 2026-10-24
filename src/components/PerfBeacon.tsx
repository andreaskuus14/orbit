"use client";
// Reports long frames (>150 ms) with script attribution and galaxy context to /api/perf, so a freeze in the owner's
// own window can be diagnosed. Also the fps meter: one rAF loop writes frame times into a preallocated ring (no
// per-frame allocation); every 10 s the window's p50/p95/p99 and fps go up per scene. Hidden-tab time is skipped.
// Shift+F toggles a small readout. Cheap: one POST every 10 s, only when there is something to send.
import { useEffect, useState } from "react";
import { FrameRing, frameStats, sceneOf } from "@/lib/perf-pure";

type Ctx = Record<string, unknown>;
export const perfCtx: Ctx = {}; // the galaxy writes its state here (level, stop, selected, paused); Orbit writes dive

const RING = 4096; // 10 s at up to ~400 Hz; it wraps (keeps the newest) past that
const ring = new FrameRing(RING), scratch = new Float32Array(RING);
const marks: unknown[] = [];
/** Records a boot milestone (ms since navigation) for /api/perf, e.g. when the galaxy first drew. */
export function perfMark(name: string) { marks.push({ at: Math.round(performance.now()), ms: 0, mark: name, scripts: [], ctx: { ...perfCtx, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vis: document.visibilityState } }); }

export function PerfBeacon() {
  const [hud, setHud] = useState<string | null>(null);

  useEffect(() => {
    const q: unknown[] = [], frames: unknown[] = [];
    let po: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
      po = new PerformanceObserver((l) => {
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
    }

    // fps meter
    let scene = sceneOf(perfCtx), last = 0, raf = 0;
    ring.reset();
    const flush = () => {
      const s = frameStats(ring, scratch);
      ring.reset();
      if (!s || s.n < 30) return; // a few frames around a scene switch say nothing
      let cw = 0;
      for (const c of document.querySelectorAll("canvas")) if (c.offsetParent !== null) cw = Math.max(cw, c.width);
      frames.push({ scene, ...s, dpr: devicePixelRatio, cw, level: typeof perfCtx.level === "number" ? perfCtx.level : -1, vis: document.visibilityState });
    };
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const sc = sceneOf(perfCtx);
      if (sc !== scene) { flush(); scene = sc; last = t; return; }
      if (last) ring.push(t - last);
      last = t;
    };
    const onVis = () => { if (document.hidden) flush(); last = 0; }; // the gap across a hidden period is not a frame
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(tick);

    const t = setInterval(() => {
      if (!document.hidden) flush();
      q.push(...marks.splice(0));
      if (!q.length && !frames.length) return;
      void fetch("/api/perf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: q.splice(0), frames: frames.splice(0) }) }).catch(() => {});
    }, 10_000);
    return () => { po?.disconnect(); clearInterval(t); cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Shift+F: live readout of the current window (not while typing).
  useEffect(() => {
    let iv = 0;
    const show = () => { const s = frameStats(ring, scratch); if (s && s.n >= 10) setHud(`${Math.round(s.fps)} fps · p95 ${s.p95} ms`); };
    const k = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.code !== "KeyF") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable=true]")) return;
      if (iv) { clearInterval(iv); iv = 0; setHud(null); } else { setHud("…"); show(); iv = window.setInterval(show, 500); }
    };
    addEventListener("keydown", k);
    return () => { removeEventListener("keydown", k); clearInterval(iv); };
  }, []);

  if (hud === null) return null;
  return <div className="glass hud-title num pointer-events-none fixed right-3 top-3 z-50 px-2 py-1 !text-[0.7rem]" aria-live="off">{hud}</div>;
}
