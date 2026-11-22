"use client";
// ORBIT_UI_MOTION on the client (feat/ui-motion): the root layout stamps <html data-motion="on|off"> from the server env.
// Helpers for the shared-element view transitions (home card → focused job → back), with a plain-mount fallback.
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { CORE_PHASE_EVENT, type PhaseEvent } from "@/lib/core-phase-pure";

export const motionActive = () => typeof document !== "undefined" && document.documentElement.dataset.motion === "on";
const reducedNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Is the new motion on (after mount; false on the server so markup matches)? */
export function useUiMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(motionActive()), []);
  return on;
}

/** Tell the CORE orb what is happening (CoreChat's stream, the voice input, the command bar). */
export const corePhase = (ev: PhaseEvent) => { if (typeof window !== "undefined") dispatchEvent(new CustomEvent<PhaseEvent>(CORE_PHASE_EVENT, { detail: ev })); };

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
const SHARED = "work-focus";

/** Run a state change as one view transition. The card with data-progress-id=`id` (if on screen) and the focused view share
 *  the name "work-focus", so the card grows into the view and shrinks back. Without the API (or motion off / reduced), the
 *  update runs directly and the views' own CSS enter animations play instead. */
export function sharedTransition(update: () => void, o: { id?: string; dir: "open" | "close" }) {
  const d = typeof document !== "undefined" ? (document as VTDoc) : null;
  if (!d?.startViewTransition || !motionActive() || reducedNow()) { update(); return; }
  const card = () => (o.id ? d.querySelector<HTMLElement>(`[data-progress-id="${CSS.escape(o.id)}"]`) : null);
  const focus = () => d.querySelector<HTMLElement>(".focus-work");
  if (o.dir === "open") { const c = card(); if (c && c.getClientRects().length) c.style.viewTransitionName = SHARED; }
  let named: HTMLElement | null = null;
  const vt = d.startViewTransition(() => {
    flushSync(update);
    const c = card();
    if (o.dir === "open") { if (c) c.style.viewTransitionName = ""; } // the view has the name now
    else if (c && !focus() && c.getClientRects().length) { c.style.viewTransitionName = SHARED; named = c; }
  });
  void vt.finished.finally(() => { if (named) named.style.viewTransitionName = ""; const c = card(); if (c && o.dir === "open") c.style.viewTransitionName = ""; });
}
