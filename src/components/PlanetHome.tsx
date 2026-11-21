"use client";
// Planet page, one pattern on every planet (owner 21 Nov: "I have a problem → ORBIT fixes it → I can see the progress"):
// 1. one sentence: what this planet is for; 2. the main action: one box "what do you need?" (and the planet's own main button);
// 3. "Working on it": the shared progress cards (ProgressCard) for this planet's running work, plus what waits for his click;
// 4. results, each saying what happened and what to do next; 5. "More": example asks and all of the planet's tools, unchanged.
// The Ask carries the planet (Orbit adds "here"), so CORE knows where he is. Nothing here approves or sends anything by itself.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { planetNeeds, type Need } from "@/lib/needs-you-pure";
import { planetById } from "@/lib/planets";
import { linkToHash } from "@/lib/deeplink-pure";
import type { Progress } from "@/lib/progress-pure";
import { examples as pickExamples } from "@/lib/planet-page-pure";
import { VOICE_ASK } from "./voice/bus";
import { openTarget } from "./NeedsYou";
import { nav } from "./palette-commands";
import { ProgressList } from "./ProgressCard";
import type { PanelId } from "@/lib/planets";
import { useT } from "./i18n";
import css from "./PlanetHome.module.css";
import { useManual as useManualChoice } from "./planet-manual";

/** One result: what happened (title + sub) and the one next step (next, default "Open"). */
export type PlanetResult = { id: string; title: string; sub?: string; next?: string; open: () => void };
export type SimplePlanet = "creation" | "operations" | "business" | "agents" | "studio" | "life" | "vault" | "analytics" | "memory" | "arch" | "intelligence" | "profile";
/** Orbit.tsx listens: Ask mode on, focus the command bar. */
export const ASK_FOCUS = "orbit:ask-focus";

/** His "simple page / all tools" choice per planet. */
export function useManual(planet: SimplePlanet) { return useManualChoice(planet); }

export function PlanetHome({ planet, results, work, primary, action, onManual, onOpenTask, onOpenGoal, onExample, children, noInput }: {
  planet: SimplePlanet; results?: PlanetResult[] | null; onManual: () => void;
  work?: Progress[] | null /* this planet's running jobs as shared progress cards; undefined = the planet has no job list of its own */;
  primary?: { label: string; run: () => void; busy?: boolean } /* the planet's one main button, when it has a clear one */;
  onOpenTask?: (id: string) => void; onOpenGoal?: (id: string) => void; children?: ReactNode /* planet-specific "needs you" items */;
  onExample?: (q: string) => void /* a world with its own AI box (ARCH) runs the ask there instead of in CORE */;
  noInput?: boolean /* the planet brings its own input (ARCH: pass it as action) */; action?: ReactNode /* the planet's own main input, shown in the main-action place */;
}) {
  const { t, lang } = useT();
  const openTask = onOpenTask ?? ((id: string) => { location.hash = linkToHash({ planet: "operations", kind: "task", id }); }); // worlds without a task opener: the deep link
  const [needs, setNeeds] = useState<ReturnType<typeof planetNeeds> | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/needs-you?lang=${lang}`, { cache: "no-store" }).then((r) => r.json())
      .then((j: { items?: Need[] }) => { if (live) setNeeds(planetNeeds(planet, j.items ?? [])); }, () => { if (live) setNeeds({ own: [], elsewhere: [] }); });
    return () => { live = false; };
  }, [lang, planet]);
  const ask = onExample ?? ((q: string) => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: q } })));
  const submit = (e: FormEvent) => { e.preventDefault(); const q = text.trim(); if (!q) { dispatchEvent(new Event(ASK_FOCUS)); return; } ask(q); setText(""); };
  const examples = pickExamples([1, 2, 3].map((n) => t(`ph.${planet}.ex${n}` as "ph.creation.ex1")));
  const waiting = needs ? needs.own.reduce((s, n) => s + (n.group?.length ?? 1), 0) : 0;
  const running = (work ?? []).filter((p) => p.phase === "working" || p.phase === "waiting").length;
  const nothing = needs && !needs.own.length && !needs.elsewhere.length && !children && (work === undefined || (work && !work.length));

  return (
    <div className={css.page} aria-label={t("ph.label")} data-planet={planet}>
      {/* 1. What it's for */}
      <p className={css.what}>{t(`ph.${planet}.what` as "ph.creation.what")}</p>

      {/* 2. The main action */}
      {primary && <button type="button" className={`btn ${css.main}`} onClick={primary.run} disabled={primary.busy}>{primary.label}</button>}
      {action}
      {!noInput && (
        <form className={css.ask} onSubmit={submit}>
          <label className="sr-only" htmlFor={`ph-ask-${planet}`}>{t("ph.askLabel")}</label>
          <input id={`ph-ask-${planet}`} className="field" value={text} maxLength={500} onChange={(e) => setText(e.target.value)}
            placeholder={t(`ph.${planet}.ex1` as "ph.creation.ex1")} />
          <button type="submit" className={primary ? "chip" : "btn"}>{t("ph.do")}</button>
        </form>
      )}

      {/* 3. Working on it: running work, then what waits for his click */}
      <section aria-labelledby={`ph-work-${planet}`} className={css.block}>
        <h3 id={`ph-work-${planet}`} className={css.h}>{t("ph.working")}{running + waiting ? <span className={css.count}>{running + waiting}</span> : null}</h3>
        {work && work.length > 0 && <ProgressList items={work} max={5} />}
        {children}
        {needs?.own.length ? (
          <ul className="space-y-2">
            {needs.own.slice(0, 5).map((n) => (
              <li key={n.ref} className={`card ${css.need}`}>
                <span className={css.dot} aria-hidden="true" />
                <span className="min-w-0 flex-1"><b className="block truncate">{n.title}{n.group && ` · ${n.group.length}`}</b><small className="muted">{t("ph.waitsYou")} · {t(`needs.ask.${n.cause}`)}</small></span>
                <button className="btn shrink-0 px-3 py-1 text-xs" onClick={() => openTarget(n.act.open, openTask, onOpenGoal ?? openTask)}>{t(n.group ? "needs.reviewAll" : n.kind === "decide" ? "needs.review" : "common.open")}</button>
              </li>))}
          </ul>) : null}
        {needs?.elsewhere.length ? (
          <ul className="space-y-1">
            {needs.elsewhere.map((e) => (
              <li key={e.planet} className={`card ${css.need}`}>
                <span className="min-w-0 flex-1"><b className="block truncate">{t("ph.elsewhere", { n: e.n, planet: planetById(e.planet)?.name ?? e.planet })}</b></span>
                <button className="chip" onClick={() => nav({ panel: e.planet as PanelId })}>{t("common.open")}</button>
              </li>))}
          </ul>) : null}
        {!needs && work === undefined ? <p className="muted text-sm" role="status">{t("needs.loading")}</p>
          : nothing ? <p className={css.empty}>{t("ph.workingNone")}</p> : null}
      </section>

      {/* 4. Results */}
      {results !== undefined && (
        <section aria-labelledby={`ph-results-${planet}`} className={css.block}>
          <h3 id={`ph-results-${planet}`} className={css.h}>{t("ph.results")}</h3>
          {!results ? <p className="muted text-sm" role="status">{t("needs.loading")}</p>
            : !results.length ? <p className={css.empty}>{t("ph.resultsNone")}</p>
            : <ul className="space-y-2">{results.slice(0, 6).map((r) => (
              <li key={r.id} className={`card ${css.result}`}>
                <span className="min-w-0 flex-1"><b className="block truncate">{r.title}</b>{r.sub && <small className="muted">{r.sub}</small>}</span>
                <button className="chip shrink-0" onClick={r.open}>{r.next ?? t("common.open")}</button>
              </li>))}</ul>}
        </section>
      )}

      {/* 5. More: example asks and every tool of this planet */}
      <details className={css.more}>
        <summary>{t("ws.more")} <small className="muted">· {t("ph.moreHint")}</small></summary>
        {examples.length > 0 && <div className={css.examples}>
          <p className="muted text-xs">{t("ph.try")}</p>
          <div className="flex flex-wrap gap-1">{examples.map((x) => <button key={x} type="button" className="chip text-xs" onClick={() => ask(x)}>{x}</button>)}</div>
        </div>}
        <button type="button" className="chip" onClick={onManual}>{t("ph.manual")} →</button>
      </details>
    </div>
  );
}

/** The way back from a planet's tools to its simple page (same look everywhere). */
export function BackToSimple({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  return <button type="button" className={`link text-xs ${css.back}`} onClick={onClick}>← {t("ph.simple")}</button>;
}

/** Wrap a planet panel that has no results list of its own: simple page first, the panel itself behind More → All tools. */
export function SimpleOr({ planet, onOpenTask, onOpenGoal, children }: { planet: SimplePlanet; onOpenTask: (id: string) => void; onOpenGoal?: (id: string) => void; children: ReactNode }) {
  const [manual, setManual] = useManual(planet);
  if (!manual) return <PlanetHome planet={planet} onManual={() => setManual(true)} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} />;
  return <><BackToSimple onClick={() => setManual(false)} />{children}</>;
}
