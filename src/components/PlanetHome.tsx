"use client";
// AI-first planet home (owner 19 Nov: "so many buttons, I don't know what they do; I have AI, it should do everything"):
// one ask box (goes to CORE), only what needs his decision, and recent results with Open. The planet's old tools stay one
// click away behind "Manual tools", unchanged.
import { useEffect, useState } from "react";
import type { Need } from "@/lib/needs-you-pure";
import { VOICE_ASK } from "./voice/bus";
import { openTarget } from "./NeedsYou";
import { useT } from "./i18n";

export type PlanetResult = { id: string; title: string; sub?: string; open: () => void };
type Planet = "creation" | "operations";

/** His "use simple view / manual tools" choice per planet (a per-viewer convenience; works without storage). */
export function useManual(planet: Planet): [boolean, (on: boolean) => void] {
  const key = `orbit.manual.${planet}`;
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem(key) === "1"); } catch { /* no storage: simple view */ } }, [key]);
  return [on, (v: boolean) => { setOn(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* no storage */ } }];
}

/** Which "Needs you" items belong on this planet: OPERATIONS is the work hub (every decision and blocker); GAME DEV gets the ones that open there. */
const belongs = (planet: Planet, n: Need) => {
  if (planet === "operations") return n.kind === "decide" || n.kind === "unblock";
  const o = n.act.open as { panel?: string; link?: string };
  return o.panel === "creation" || (typeof o.link === "string" && o.link.includes("o=creation"));
};

export function PlanetHome({ planet, results, onManual, onOpenTask, onOpenGoal }: {
  planet: Planet; results: PlanetResult[] | null; onManual: () => void;
  onOpenTask: (id: string) => void; onOpenGoal?: (id: string) => void;
}) {
  const { t, lang } = useT();
  const [text, setText] = useState("");
  const [items, setItems] = useState<Need[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/needs-you?lang=${lang}`, { cache: "no-store" }).then((r) => r.json())
      .then((j: { items?: Need[] }) => { if (live) setItems((j.items ?? []).filter((n) => belongs(planet, n))); }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, [lang, planet]);
  const ask = (q: string) => { const s = q.trim(); if (!s) return; dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: s } })); setText(""); };
  const examples = [1, 2, 3].map((n) => t(`ph.${planet}.ex${n}` as "ph.creation.ex1"));

  return (
    <div className="space-y-4" aria-label={t("ph.label")}>
      <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <div className="flex gap-2">
          <input className="field flex-1" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
            placeholder={t(`ph.${planet}.ph` as "ph.creation.ph")} aria-label={t(`ph.${planet}.ph` as "ph.creation.ph")} />
          <button className="btn" disabled={!text.trim()}>{t("ph.send")}</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {examples.map((x) => <button key={x} type="button" className="chip text-xs" onClick={() => ask(x)}>{x}</button>)}
        </div>
      </form>

      <section aria-labelledby={`ph-needs-${planet}`}>
        <h3 id={`ph-needs-${planet}`} className="h3">{t("ph.needs")}{items?.length ? ` · ${items.length}` : ""}</h3>
        {!items ? <p className="muted text-sm" role="status">{t("needs.loading")}</p>
          : !items.length ? <p className="muted text-sm">{t("ph.needsNone")}</p>
          : <ul className="mt-1 space-y-1">{items.slice(0, 5).map((n) => (
            <li key={n.ref} className="card flex items-center gap-2">
              <span className="min-w-0 flex-1"><b className="block truncate">{n.title}</b><small className="muted">{t(`needs.ask.${n.cause}`)}</small></span>
              <button className="chip" onClick={() => openTarget(n.act.open, onOpenTask, onOpenGoal ?? onOpenTask)}>{t(n.kind === "decide" ? "needs.review" : "common.open")}</button>
            </li>))}</ul>}
      </section>

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

      <button className="link text-xs" onClick={onManual}>⚙ {t("ph.manual")}</button>
    </div>
  );
}
