"use client";
// AI-first planet home (owner 19 Nov: "so many buttons, I don't know what they do; I have AI, it should do everything"):
// example asks (they go to CORE; the CORE bar below is the one place to type), only what needs his decision, and recent
// results with Open. The planet's old tools stay one click away behind "Manual tools", unchanged.
import { useEffect, useState, type ReactNode } from "react";
import { planetNeeds, type Need } from "@/lib/needs-you-pure";
import { planetById } from "@/lib/planets";
import { VOICE_ASK } from "./voice/bus";
import { openTarget } from "./NeedsYou";
import { nav } from "./palette-commands";
import type { PanelId } from "@/lib/planets";
import { useT } from "./i18n";

export type PlanetResult = { id: string; title: string; sub?: string; open: () => void };
export type SimplePlanet = "creation" | "operations" | "business" | "agents";

/** His "use simple view / manual tools" choice per planet (a per-viewer convenience; works without storage). */
export function useManual(planet: SimplePlanet): [boolean, (on: boolean) => void] {
  const key = `orbit.manual.${planet}`;
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem(key) === "1"); } catch { /* no storage: simple view */ } }, [key]);
  return [on, (v: boolean) => { setOn(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* no storage */ } }];
}

export function PlanetHome({ planet, results, onManual, onOpenTask, onOpenGoal }: {
  planet: SimplePlanet; results?: PlanetResult[] | null; onManual: () => void;
  onOpenTask: (id: string) => void; onOpenGoal?: (id: string) => void;
}) {
  const { t, lang } = useT();
  const [needs, setNeeds] = useState<ReturnType<typeof planetNeeds> | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/needs-you?lang=${lang}`, { cache: "no-store" }).then((r) => r.json())
      .then((j: { items?: Need[] }) => { if (live) setNeeds(planetNeeds(planet, j.items ?? [])); }, () => { if (live) setNeeds({ own: [], elsewhere: [] }); });
    return () => { live = false; };
  }, [lang, planet]);
  const ask = (q: string) => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: q } }));
  const examples = [1, 2, 3].map((n) => t(`ph.${planet}.ex${n}` as "ph.creation.ex1"));
  const count = needs ? needs.own.reduce((s, n) => s + (n.group?.length ?? 1), 0) : 0;

  return (
    <div className="space-y-4" aria-label={t("ph.label")}>
      <section className="card space-y-2" aria-labelledby={`ph-try-${planet}`}>
        <h3 id={`ph-try-${planet}`} className="h3">{t("ph.try")}</h3>
        <div className="flex flex-wrap gap-1">
          {examples.map((x) => <button key={x} type="button" className="chip text-xs" onClick={() => ask(x)}>{x}</button>)}
        </div>
      </section>

      <section aria-labelledby={`ph-needs-${planet}`}>
        <h3 id={`ph-needs-${planet}`} className="h3">{t("ph.needs")}{count ? ` · ${count}` : ""}</h3>
        {!needs ? <p className="muted text-sm" role="status">{t("needs.loading")}</p>
          : !needs.own.length && !needs.elsewhere.length ? <p className="muted text-sm">{t("ph.needsNone")}</p>
          : <ul className="mt-1 space-y-1">
            {needs.own.slice(0, 5).map((n) => (
              <li key={n.ref} className="card flex items-center gap-2">
                <span className="min-w-0 flex-1"><b className="block truncate">{n.title}{n.group && ` · ${n.group.length}`}</b><small className="muted">{t(`needs.ask.${n.cause}`)}</small></span>
                <button className="chip" onClick={() => openTarget(n.act.open, onOpenTask, onOpenGoal ?? onOpenTask)}>{t(n.group ? "needs.reviewAll" : n.kind === "decide" ? "needs.review" : "common.open")}</button>
              </li>))}
            {needs.elsewhere.map((e) => (
              <li key={e.planet} className="card flex items-center gap-2">
                <span className="min-w-0 flex-1"><b className="block truncate">{t("ph.elsewhere", { n: e.n, planet: planetById(e.planet)?.name ?? e.planet })}</b></span>
                <button className="chip" onClick={() => nav({ panel: e.planet as PanelId })}>{t("common.open")}</button>
              </li>))}
          </ul>}
      </section>

      {results !== undefined && (
        <section aria-labelledby={`ph-results-${planet}`}>
          <h3 id={`ph-results-${planet}`} className="h3">{t("ph.results")}</h3>
          {!results ? <p className="muted text-sm" role="status">{t("needs.loading")}</p>
            : !results.length ? <p className="muted text-sm">{t("ph.resultsNone")}</p>
            : <ul className="mt-1 space-y-1">{results.slice(0, 6).map((r) => (
              <li key={r.id} className="card flex items-center gap-2">
                <span className="min-w-0 flex-1"><b className="block truncate">{r.title}</b>{r.sub && <small className="muted">{r.sub}</small>}</span>
                <button className="chip" onClick={r.open}>▶ {t("common.open")}</button>
              </li>))}</ul>}
        </section>
      )}

      <button className="link text-xs" onClick={onManual}>⚙ {t("ph.manual")}</button>
    </div>
  );
}

/** Wrap a planet panel that has no results list of its own: simple home first, the panel itself behind "Manual tools". */
export function SimpleOr({ planet, onOpenTask, onOpenGoal, children }: { planet: SimplePlanet; onOpenTask: (id: string) => void; onOpenGoal?: (id: string) => void; children: ReactNode }) {
  const { t } = useT();
  const [manual, setManual] = useManual(planet);
  if (!manual) return <PlanetHome planet={planet} onManual={() => setManual(true)} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} />;
  return <><button className="link mb-2 text-xs" onClick={() => setManual(false)}>← {t("ph.simple")}</button>{children}</>;
}
