"use client";
import { useCallback, useEffect, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { PALETTE_EVENT } from "@/lib/palette-pure";
import {
  CHAPTERS, SETUP, START, STEPS, TOUR_EVENT, TOUR_KEY, back, chapterDone, chapterOf, goTo, next, openChapter, parseProgress,
  position, resume, setupUrl, shouldAutoOpen, skip, type Progress,
} from "@/lib/tour-pure";
import { useT } from "./i18n";

// "What's new" as a guided tour (chapters, steps, Show me, setup hints). Data and rules: lib/tour-pure.ts.
// Opens by itself once per TOUR_KEY; afterwards only from Ctrl+K → "What's new tour" (TOUR_EVENT), where it resumes.
const load = () => { try { return parseProgress(localStorage.getItem(TOUR_KEY)); } catch { return null; } };
const save = (p: Progress) => { try { localStorage.setItem(TOUR_KEY, JSON.stringify(p)); } catch { /* no storage: this session only */ } };

export function WhatsNew({ home }: { home: boolean }) {
  const { lang, t } = useT();
  const [p, setP] = useState<Progress | null>(null);
  const [active, setActive] = useState(false); // this session: shown on the galaxy until skipped or finished
  const update = useCallback((q: Progress) => { setP(q); save(q); if (q.closed) setActive(false); }, []);

  useEffect(() => {
    const stored = load();
    if (shouldAutoOpen(stored)) { update(goTo(START, START.at)); setActive(true); } else setP(stored);
    const reopen = () => { update(resume(load())); setActive(true); };
    addEventListener(TOUR_EVENT, reopen);
    return () => removeEventListener(TOUR_EVENT, reopen);
  }, [update]);

  const show = active && home && p && !p.closed;
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") update(skip(p)); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [show, p, update]);
  if (!show) return null;

  const step = STEPS.find((x) => x.id === p.at) ?? STEPS[0];
  const chapter = chapterOf(step.id);
  const { n, total } = position(p);
  // Show me: move on first, so coming back to the galaxy continues with the next step.
  const showMe = () => {
    update(next(p));
    if (step.go) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: step.go }));
    else if (step.event === "palette") dispatchEvent(new Event(PALETTE_EVENT));
  };
  return (
    <>
    {/* Phones only (CSS): the card becomes a top sheet over a tap-to-dismiss backdrop. */}
    <div className="sheet-backdrop" onClick={() => update(skip(p))} aria-hidden />
    <section className="glass hud-panel whats-new absolute left-3 top-16 z-20 w-[min(24rem,calc(100vw-1.5rem))] p-4 text-sm" role="dialog" aria-labelledby="whats-new-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="whats-new-title" className="hud-title">{t("tour.title")} <span className="muted">· {t("tour.step", { n, total })}</span></h2>
        <button className="chip" onClick={() => update(skip(p))} aria-label={t("tour.skipAria")} title={t("tour.skipAria")}>{t("tour.skip")}</button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={t("tour.chapters")}>
        {CHAPTERS.map((c) => (
          <button key={c.id} className="chip text-xs" aria-pressed={c.id === chapter.id} onClick={() => update(openChapter(p, c.id))}>
            {c.icon} {c.title[lang]}{chapterDone(p, c) ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        <h3 className="mb-1 font-semibold">{step.icon} {step.title[lang]}</h3>
        <p className="muted">{step.text[lang]}</p>
        {step.setup && (
          <p className="mt-2 text-xs">
            <b>⚙ {t("tour.setup")}</b> {SETUP[step.setup].text[lang]}{" "}
            <a className="underline" href={setupUrl(step.setup)} target="_blank" rel="noreferrer">{t("tour.setupLink")} ↗</a>
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="chip" onClick={() => update(back(p))} disabled={n === 1}>{t("tour.back")}</button>
        <span className="flex-1" />
        {(step.go || step.event) && <button className="chip" onClick={showMe}>{t("tour.showMe")}</button>}
        <button className="chip" onClick={() => update(next(p))} autoFocus>{n === total ? t("tour.finish") : t("tour.next")}</button>
      </div>
    </section>
    </>
  );
}
