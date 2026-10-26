"use client";
// Scripted perf run (roadmap 1.2), mounted by Orbit only with ?perfrun=1 (Shift+Alt+P reloads into it), so it costs
// nothing otherwise. Plays PERF_RUN_SCRIPT through orbit:navigate, buckets every frame time by step (dive frames into
// "dive"), then POSTs per-step stats, marks, quality level, render scale, canvas size, dpr and the GPU name to
// /api/perf/run and closes the window. scripts/perf-run.ps1 (npm run perf:run) opens it and prints the comparison.
import { useEffect, useState } from "react";
import { FrameRing } from "@/lib/perf-pure";
import { PERF_RUN_SCRIPT, runSegment, type RunSegment } from "@/lib/perf-run-pure";
import { NAV_EVENT } from "@/lib/nav-pure";
import { perfCtx, runMarks } from "./PerfBeacon";

const RING = 8192; // the longest bucket (5 returns = 15 s) at up to ~500 Hz

function gpuName(): string {
  const c = document.querySelector<HTMLCanvasElement>("canvas[data-engine]"); // three.js's own canvas: getContext returns its context, never a new one
  const gl = c?.getContext("webgl2");
  if (!gl) return "unknown";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

function ctxNow() {
  let cw = 0, ch = 0;
  for (const c of document.querySelectorAll("canvas")) if (c.offsetParent !== null && c.width > cw) { cw = c.width; ch = c.height; }
  return { level: typeof perfCtx.level === "number" ? perfCtx.level : -1, rdpr: typeof perfCtx.rdpr === "number" ? perfCtx.rdpr : -1, cw, ch, dpr: devicePixelRatio };
}

export default function PerfRun() {
  const [status, setStatus] = useState("Perf run: waiting for the galaxy. Hands off; reload to cancel.");

  useEffect(() => {
    const q = new URLSearchParams(location.search), w = Number(q.get("w")), h = Number(q.get("h"));
    const label = /^[\w-]{1,40}$/.test(q.get("label") ?? "") ? q.get("label")! : `${innerWidth}x${innerHeight}`;
    if (w > 0 && h > 0 && (outerWidth !== w || outerHeight !== h)) try { resizeTo(w, h); } catch { /* not allowed: the report has the real size */ }

    const rings = new Map<string, FrameRing>(), snaps = new Map<string, ReturnType<typeof ctxNow>>();
    let seg = "boot", last = 0, raf = 0, off = false, hidden = false;
    perfCtx.runSeg = seg;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const k = perfCtx.dive ? "dive" : seg;
      if (last) { let r = rings.get(k); if (!r) rings.set(k, (r = new FrameRing(RING))); r.push(t - last); }
      last = t;
      if (k === "dive") snaps.set(k, ctxNow());
    };
    const onVis = () => { if (document.hidden) hidden = true; last = 0; };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(tick);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const step = (name: string) => { snaps.set(seg, ctxNow()); seg = name; perfCtx.runSeg = name; };

    void (async () => {
      const t0 = performance.now();
      while (!off && !runMarks?.some((m) => m.mark === "galaxy-drawn") && performance.now() - t0 < 60_000) await wait(100);
      for (const s of PERF_RUN_SCRIPT) {
        if (off) return;
        step(s.seg);
        if (s.nav !== undefined) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: s.nav } }));
        setStatus(`Perf run: ${s.seg}`);
        await wait(s.ms);
      }
      step("end");
      cancelAnimationFrame(raf);
      const scratch = new Float32Array(RING), segments: RunSegment[] = [];
      for (const [name, r] of rings) { const st = runSegment(r, scratch); if (st && st.n >= 10) segments.push({ seg: name, ...st, ...(snaps.get(name) ?? ctxNow()) }); }
      const body = { label, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, gpu: gpuName(), hidden, segments, marks: runMarks ?? [] };
      const ok = await fetch("/api/perf/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok, () => false);
      if (off) return;
      setStatus(ok ? "Perf run saved. Closing…" : "Perf run: saving failed (see the server log).");
      if (ok) setTimeout(() => close(), 1500); // works for the --app window perf-run.ps1 opens; otherwise the message stays
    })();
    return () => { off = true; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); delete perfCtx.runSeg; };
  }, []);

  return <div className="glass hud-title num pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 px-3 py-1 !text-[0.7rem]" role="status">{status}</div>;
}
