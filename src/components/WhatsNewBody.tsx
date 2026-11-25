"use client";
import { useCallback, useEffect, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { PALETTE_EVENT } from "@/lib/palette-pure";
import {
  CHAPTERS, SETUP, STEPS, TOUR_EVENT, TOUR_KEY, back, chapterDone, chapterOf, next, openChapter, parseProgress,
  position, resume, setupUrl, skip, type Progress,
} from "@/lib/tour-pure";
import { useT } from "./i18n";
import { announce } from "./announce";
import { KNOWN_KEY, newSince, parseKnown, showSetup } from "@/lib/startup-pure";
import { setReady, useOpenRequest, useTurn } from "./startup-store";
import { Button } from "./ui/Button";
import "@/app/planet-ui.css";

// "What's new" as a guided tour (chapters, steps, Show me, setup hints). Data and rules: lib/tour-pure.ts.
// Never opens by itself (quiet open): new steps wait as a "new" dot in the header pill; the full tour opens from Ctrl+K → "What's new tour" (TOUR_EVENT), where it resumes.
// Loaded by the WhatsNew gate (WhatsNew.tsx) only when one of those applies.
const load = () => { try { return parseProgress(localStorage.getItem(TOUR_KEY)); } catch { return null; } };
const markKnown = () => { try { localStorage.setItem(KNOWN_KEY, JSON.stringify(STEPS.map((x) => x.id))); } catch { /* may show again */ } };
const save = (p: Progress) => { try { localStorage.setItem(TOUR_KEY, JSON.stringify(p)); } catch { /* no storage: this session only */ } };

export default function WhatsNewBody({ home, reopen }: { home: boolean; reopen: boolean }) {
  const { lang, t } = useT();
  const [p, setP] = useState<Progress | null>(null);
  const [active, setActive] = useState(false); // this session: shown on the galaxy until skipped or finished
  const [news, setNews] = useState<{ ids: string[]; more: boolean } | null>(null); // a short "since you last looked" card, opened from the pill
  const [newsOpen, setNewsOpen] = useState(false);
  useEffect(() => setReady("tour", !!news), [news]);
  useOpenRequest("tour", () => { if (news) setNewsOpen(true); else { update(resume(load())); setActive(true); } });
  const [missing, setMissing] = useState<string[] | null>(null); // guard-confirmed missing migrations; null = unknown (hint hidden)
  useEffect(() => { void fetch("/api/doctor?migrations=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setMissing(j?.missing ?? null)).catch(() => {}); }, []);
  const update = useCallback((q: Progress) => { setP(q); save(q); if (q.closed) setActive(false); }, []);

  useEffect(() => {
    const stored = load();
    if (reopen) { update(resume(stored)); setActive(true); } // mounted by the gate for a TOUR_EVENT that fired before this listener existed
    else { setP(stored); let known = null; try { known = parseKnown(localStorage.getItem(KNOWN_KEY)); } catch { /* treat as never seen */ }
      const n = newSince(STEPS.map((x) => x.id), known); if (n.ids.length) setNews(n); }
    const onReopen = () => { setNews(null); update(resume(load())); setActive(true); };
    addEventListener(TOUR_EVENT, onReopen);
    return () => removeEventListener(TOUR_EVENT, onReopen);
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  const turn = useTurn("tour", home && ((!!news && newsOpen) || (active && !!p && !p.closed))); // waits for an urgent alert and the morning card
  const closeNews = () => { markKnown(); setNews(null); };
  const show = turn && active && home && p && !p.closed;
  useEffect(() => { if (show) announce(t("tour.ready")); }, [show]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opening
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") update(skip(p)); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [show, p, update]);
  if (news && newsOpen && home && turn) return (
    <section className="pu pu-pop whats-new absolute left-3 top-16 z-20 w-[min(20rem,calc(100vw-1.5rem))]" data-planet="core" role="dialog" aria-labelledby="whats-new-title">
      <div className="pu-modal-head"><h2 id="whats-new-title" className="pu-title">{t("tour.title")} <span className="pu-modal-meta">· {t("tour.since")}</span></h2></div>
      <ul className="pu-pop-list">{news.ids.map((id) => { const x = STEPS.find((y) => y.id === id)!; return <li key={id}>{x.icon} <b>{x.title[lang]}</b></li>; })}</ul>
      <div className="pu-pop-foot">
        <span className="pu-spacer" />
        {news.more && <Button size="sm" onClick={() => { closeNews(); update(resume(load())); setActive(true); }}>{t("tour.seeAll")}</Button>}
        <Button size="sm" variant="primary" onClick={closeNews} autoFocus>{t("tour.gotIt")}</Button>
      </div>
    </section>
  );
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
    <section className="pu pu-pop whats-new absolute left-3 top-16 z-20 w-[min(20rem,calc(100vw-1.5rem))]" data-planet="core" role="dialog" aria-labelledby="whats-new-title">
      <div className="pu-modal-head">
        <h2 id="whats-new-title" className="pu-title">{t("tour.title")} <span className="pu-modal-meta">· {t("tour.step", { n, total })}</span></h2>
        <Button size="sm" variant="ghost" onClick={() => update(skip(p))} label={t("tour.skipAria")} title={t("tour.skipAria")}>{t("tour.skip")}</Button>
      </div>
      <div className="pu-pop-chips" role="group" aria-label={t("tour.chapters")}>
        {CHAPTERS.map((c) => (
          <button key={c.id} type="button" className="pu-chip" aria-pressed={c.id === chapter.id} onClick={() => update(openChapter(p, c.id))}>
            {c.icon} {c.title[lang]}{chapterDone(p, c) ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        <h3 className="pu-pop-step">{step.icon} {step.title[lang]}</h3>
        <p className="pu-pop-text">{step.text[lang]}</p>
        {step.setup && showSetup(step.setup, missing) && (
          <p className="pu-modal-meta" style={{ marginTop: 8 }}>
            <b>⚙ {t("tour.setup")}</b> {SETUP[step.setup].text[lang]}{" "}
            <a className="pu-link" href={setupUrl(step.setup)} target="_blank" rel="noreferrer">{t("tour.setupLink")} ↗</a>
          </p>
        )}
      </div>
      <div className="pu-pop-foot">
        <Button size="sm" onClick={() => update(back(p))} disabled={n === 1}>{t("tour.back")}</Button>
        <span className="pu-spacer" />
        {(step.go || step.event) && <Button size="sm" onClick={showMe}>{t("tour.showMe")}</Button>}
        <Button size="sm" variant="primary" onClick={() => update(next(p))} autoFocus>{n === total ? t("tour.finish") : t("tour.next")}</Button>
      </div>
    </section>
    </>
  );
}
