"use client";
// CORE's presence (feat/ui-motion): an orb with an aurora ring. Its pose follows what CORE is doing: listening (ripples),
// thinking (a breath in, then out; faster aurora), using a tool (a light circles it; the label names the tool in plain words),
// writing (bright and quick), done (one soft settle, then idle). Poses are held long enough to read (core-phase-pure HOLD).
// CSS only (motion.css): transform/opacity, no canvas. Hidden when ORBIT_UI_MOTION=0.
import { useEffect, useState } from "react";
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

/** The orb alone (decorative; the label carries the meaning for screen readers). */
export function CoreOrb({ phase }: { phase: CorePhase }) {
  return (
    <span className="core-orb" data-phase={phase} aria-hidden="true">
      <span className="orb-halo" /><span className="orb-ripple" /><span className="orb-ripple" />
      <span className="orb-aurora" /><span className="orb-core" /><span className="orb-orbit" />
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
