"use client";
// CORE's presence (feat/ui-motion): an orb with an aurora ring. Its pose follows what CORE is doing: listening (ripples),
// thinking (a breath in, then out; faster aurora), using a tool (a light circles it; the label names the tool in plain words),
// writing (bright and quick), done (one soft settle, then idle). Poses are held long enough to read (core-phase-pure HOLD).
// The orb itself is a small WebGL2 shader (orb-shader.ts, motion curves in orb-motion-pure.ts); without WebGL2, or if the GPU
// drops the context, the CSS orb (motion.css) shows instead. Hidden when ORBIT_UI_MOTION=0.
import { useEffect, useRef, useState } from "react";
import { orbBeat, orbClock0, orbDpr, orbFrame, orbMotionInit, orbPerfInit, orbPerfSample, orbQuality, orbRetarget, orbSettled, orbStill, orbTier, type OrbMotion, type OrbPerf } from "@/lib/orb-motion-pure";
import { createOrbRenderer, type OrbRenderer } from "./orb-gl";
import { CORE_PHASE_EVENT, idlePhase, nextTickIn, phaseLabel, phaseReduce, phaseTick, type CorePhase, type PhaseEvent, type PhaseState } from "@/lib/core-phase-pure";
import { useT } from "../i18n";

const now = () => performance.now();

/** The orb's state machine, fed by CORE_PHASE_EVENT. */
export function useCorePhase(): PhaseState {
  const [s, setS] = useState<PhaseState>(() => idlePhase(0));
  useEffect(() => {
    const on = (e: Event) => { const ev = (e as CustomEvent<PhaseEvent>).detail; if (ev) setS((p) => phaseReduce(p, ev, now())); };
    addEventListener(CORE_PHASE_EVENT, on);
    return () => removeEventListener(CORE_PHASE_EVENT, on);
  }, []);
  useEffect(() => { // sleep until the next hold ends or done settles; no polling
    const ms = nextTickIn(s, now());
    if (ms === null) return;
    const t = setTimeout(() => setS((p) => phaseTick(p, now())), ms + 8);
    return () => clearTimeout(t);
  }, [s]);
  return s;
}

const reducedMq = () => (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null);

/** Drive the shader orb on `canvas`: eased pose changes, a beat per text chunk, paused when the tab is hidden or the orb is
 *  off screen, one still frame per pose under reduced motion. Quality follows the orb's size (orbTier) and steps down by
 *  itself if frames cost too much (GPU timer, else animation-frame gaps; orbPerfSample). Returns false (→ CSS orb) when WebGL2 is missing or lost. */
function useShaderOrb(canvas: React.RefObject<HTMLCanvasElement | null>, phase: CorePhase): boolean {
  const [ok, setOk] = useState(false);
  const phaseRef = useRef(phase);
  const api = useRef<{ setPhase(p: CorePhase): void } | null>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const r: OrbRenderer | null = createOrbRenderer(c);
    if (!r) return;
    setOk(true);
    let m: OrbMotion = orbMotionInit(phaseRef.current, performance.now());
    let clock = orbClock0();
    let raf = 0, last = 0, lastCb = 0, visible = true, onScreen = true, sizeTier = 2, tier = 2, skip = false;
    let perf: OrbPerf = orbPerfInit();
    const mq = reducedMq();
    let reduced = !!mq?.matches;
    const size = () => {
      const css = c.clientWidth || 1;
      sizeTier = orbTier(css * 0.6); // the sphere is 60% of the canvas
      const q = orbQuality(sizeTier, perf.down);
      tier = q.tier;
      const px = Math.max(1, Math.round(css * orbDpr(devicePixelRatio) * q.dprScale));
      r.resize(px, px);
    };
    const still = () => { size(); r.draw(orbStill(m.phase), tier); };
    const frame = (t: number) => {
      raf = 0;
      if (!visible || !onScreen || reduced) return;
      // cost check: GPU time when the browser can measure it, else the gap between animation frames
      const gpu = r.gpuMs();
      const before = perf.down;
      perf = orbPerfSample(perf, gpu !== undefined ? { gpuMs: gpu } : { frameMs: lastCb ? t - lastCb : undefined }, t);
      lastCb = t;
      if (perf.down !== before) size();
      // settled (no move, one-shot or beat in flight): draw every other refresh — the slow swirl looks the same at half rate
      skip = !skip && orbSettled(m, t);
      if (skip) { raf = requestAnimationFrame(frame); return; }
      const dt = last ? Math.min(t - last, 50) / 1000 : 0; // a long gap (tab was away) never jumps the clocks
      last = t;
      const f = orbFrame(m, clock, t, dt);
      clock = f.clock;
      r.draw(f.u, tier);
      raf = requestAnimationFrame(frame); // rAF = the display's own refresh, never faster
    };
    const kick = () => { if (reduced) { still(); return; } if (!raf && visible && onScreen) { last = 0; lastCb = 0; raf = requestAnimationFrame(frame); } };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    api.current = {
      setPhase(p) {
        m = orbRetarget(m, p, performance.now());
        if (reduced) { // still frames + a gentle fade between them
          c.style.opacity = "0.55"; still();
          requestAnimationFrame(() => { c.style.opacity = ""; });
        }
      },
    };
    const onBeat = (e: Event) => { if ((e as CustomEvent<PhaseEvent>).detail?.type === "delta") m = orbBeat(m, performance.now()); };
    const onVis = () => { visible = !document.hidden; if (visible) kick(); else stop(); };
    const onMq = () => { reduced = !!mq?.matches; stop(); kick(); };
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { onScreen = es.some((x) => x.isIntersecting); if (onScreen) kick(); else stop(); }) : null;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { size(); if (reduced) still(); }) : null;
    const onLost = (e: Event) => { e.preventDefault(); stop(); setOk(false); };
    io?.observe(c); ro?.observe(c);
    addEventListener(CORE_PHASE_EVENT, onBeat);
    document.addEventListener("visibilitychange", onVis);
    mq?.addEventListener("change", onMq);
    c.addEventListener("webglcontextlost", onLost);
    size(); kick();
    return () => {
      stop(); io?.disconnect(); ro?.disconnect();
      removeEventListener(CORE_PHASE_EVENT, onBeat);
      document.removeEventListener("visibilitychange", onVis);
      mq?.removeEventListener("change", onMq);
      c.removeEventListener("webglcontextlost", onLost);
      api.current = null; r.dispose();
    };
  }, [canvas]);
  useEffect(() => { phaseRef.current = phase; api.current?.setPhase(phase); }, [phase]);
  return ok;
}

/** The orb alone (decorative; the label carries the meaning for screen readers). The CSS layers render first (server markup
 *  and the no-WebGL2 fallback); once the shader runs they are hidden. */
export function CoreOrb({ phase }: { phase: CorePhase }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const gl = useShaderOrb(canvas, phase);
  return (
    <span className="core-orb" data-phase={phase} data-gl={gl ? "on" : undefined} aria-hidden="true">
      <span className="orb-halo" /><span className="orb-ripple" /><span className="orb-ripple" />
      <span className="orb-aurora" /><span className="orb-core" /><span className="orb-orbit" />
      <canvas ref={canvas} className="orb-gl" />
    </span>
  );
}

/** Orb + plain label. `state` lets a parent drive it (the recording stage); otherwise it listens to CORE itself.
 *  hideIdle: render nothing while idle (home shows it only while something happens). */
export function CorePresence({ size = "sm", state, hideIdle = false, className = "" }: { size?: "sm" | "lg"; state?: PhaseState; hideIdle?: boolean; className?: string }) {
  const own = useCorePhase();
  const s = state ?? own;
  const { lang } = useT();
  if (hideIdle && s.phase === "idle") return null;
  const label = phaseLabel(s, lang);
  const active = s.phase === "thinking" || s.phase === "tool" || s.phase === "writing" || s.phase === "listening";
  return (
    <div className={`core-presence ${className}`} data-size={size} data-phase={s.phase}>
      <CoreOrb phase={s.phase} />
      <span className="core-presence-label" role="status" aria-live="polite">
        {/* key: each new label enters on its own (a clear change of pose), the old one is simply replaced */}
        {label && <span key={`${s.phase}:${label}`} className={active ? "shimmer-text" : undefined}>{label}{active ? "…" : ""}</span>}
      </span>
    </div>
  );
}
