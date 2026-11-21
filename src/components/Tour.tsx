"use client";
// First-run tour (about 60 s, skippable, re-opened from the "?" button in the top bar): the galaxy, the one input (CORE), the
// "Working on it" cards, Needs you and Stop all. Each step rings the real element (data-tour="…") and says what it is in plain
// words. Shown once per browser; nothing is sent anywhere.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "./i18n";

export const TOUR_EVENT = "orbit:tour";
const KEY = "orbit.tour.v1";
const STEPS = [
  { id: "galaxy", target: null },
  { id: "ask", target: "ask" },
  { id: "progress", target: "progress" },
  { id: "needs", target: "needs" },
  { id: "stop", target: "stop" },
  { id: "help", target: "help" },
] as const;

export function Tour({ ready }: { ready: boolean /* home is on screen and booted */ }) {
  const { t } = useT();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setStep(null); try { localStorage.setItem(KEY, "done"); } catch { /* no storage: shows again next time */ } }, []);

  useEffect(() => { // first run
    if (!ready) return;
    let seen = true;
    try { seen = localStorage.getItem(KEY) === "done"; } catch { /* no storage: don't nag */ }
    if (seen) return;
    const tm = setTimeout(() => setStep(0), 2500); // after the boot intro
    return () => clearTimeout(tm);
  }, [ready]);
  useEffect(() => { const on = () => setStep(0); addEventListener(TOUR_EVENT, on); return () => removeEventListener(TOUR_EVENT, on); }, []);

  const s = step === null ? null : STEPS[step];
  useLayoutEffect(() => {
    if (!s?.target) { setRect(null); return; }
    const find = () => { const at = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`); const el = at && getComputedStyle(at).display === "contents" ? at.firstElementChild : at; setRect(el && el.getClientRects().length ? el.getBoundingClientRect() : null); };
    find();
    addEventListener("resize", find);
    return () => removeEventListener("resize", find);
  }, [s]);
  useEffect(() => { if (step !== null) card.current?.focus(); }, [step]);
  if (step === null || !s) return null;

  const last = step === STEPS.length - 1;
  const next = () => (last ? close() : setStep(step + 1));
  // Card above the ringed element when it sits low on the screen, else below it; centred when there is no target.
  const pos: React.CSSProperties = !rect ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    : rect.top > innerHeight / 2 ? { left: Math.min(Math.max(12, rect.left), innerWidth - 352), bottom: innerHeight - rect.top + 14 }
    : { left: Math.min(Math.max(12, rect.left + rect.width - 340), innerWidth - 352), top: rect.bottom + 14 };
  return (
    <div className="tour-layer" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft" && step) setStep(step - 1); }}>
      {rect && <span className="tour-ring" aria-hidden="true" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <div ref={card} tabIndex={-1} className="glass tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title" style={pos}>
        <p className="muted text-[11px]">{t("intro.count", { n: step + 1, of: STEPS.length })}</p>
        <h2 id="tour-title" className="text-base font-semibold">{t(`intro.${s.id}.title`)}</h2>
        <p className="mt-1 text-sm">{t(`intro.${s.id}.body`)}</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="link text-xs" onClick={close}>{t("intro.skip")}</button>
          <span className="flex-1" />
          {step > 0 && <button type="button" className="chip" onClick={() => setStep(step - 1)}>{t("intro.back")}</button>}
          <button type="button" className="btn px-4 py-1 text-sm" onClick={next}>{t(last ? "intro.done" : "intro.next")}</button>
        </div>
      </div>
    </div>
  );
}
