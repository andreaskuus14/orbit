"use client";
// The private app's planet wrapper (Orbit.tsx only): simple page first, the planet's tools behind More → All tools, plus the
// planets' own daily items on the simple page (BUSINESS today queue, LIFE habits). Kept out of PlanetHome so the public demo's
// import graph (tests/demo-leak.test.ts) never reaches business or LIFE code.
import { useEffect, useState, type ReactNode } from "react";
import { businessRows, type SimpleRow } from "@/lib/planet-page-pure";
import { todayQueue, type TodayItem } from "@/lib/planet-view-pure";
import type { Prospect } from "@/lib/business-pure";
import { VOICE_ASK } from "./voice/bus";
import { useT } from "./i18n";
import { BackToSimple, PlanetHome, useManual, type SimplePlanet } from "./PlanetHome";
import css from "./PlanetHome.module.css";

/** LIFE simple page: today's scheduled habits, one tap to check off (the same "check" the Habits tab sends). Only names and
 *  streaks are shown; journal text in the same reply is never rendered here. Optimistic, rolled back if the save fails. */
type HabitLite = { id: string; name: string; emoji: string; doneToday: boolean; scheduledToday: boolean; off?: boolean; streak: number };
function useTodayHabits(on: boolean) {
  const [items, setItems] = useState<HabitLite[]>([]);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch("/api/life", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!live || !Array.isArray(j?.habits)) return;
      setItems((j.habits as HabitLite[]).filter((h) => h.scheduledToday && !h.off).map(({ id, name, emoji, doneToday, scheduledToday, off, streak }) => ({ id, name, emoji, doneToday, scheduledToday, off, streak })));
    }, () => {});
    return () => { live = false; };
  }, [on]);
  const toggle = async (id: string, done: boolean) => {
    setBusy(id); setErr("");
    setItems((xs) => xs.map((h) => (h.id === id ? { ...h, doneToday: done } : h)));
    try {
      const r = await fetch("/api/life", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", id, done }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Failed (${r.status})`); }
    } catch (e) {
      setItems((xs) => xs.map((h) => (h.id === id ? { ...h, doneToday: !done } : h)));
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  };
  return { items, busy, err, toggle };
}


/** Wrap a planet panel (opened by Orbit): simple page first, the panel itself behind More → All tools. BUSINESS gets its
 *  latest items as results; LIFE shows none on purpose (its text stays private, and there's nothing for ORBIT to "make" there). */
export function SimpleOr({ planet, onOpenTask, onOpenGoal, children }: { planet: SimplePlanet; onOpenTask: (id: string) => void; onOpenGoal?: (id: string) => void; children: ReactNode }) {
  const { t, lang } = useT();
  const [manual, setManual] = useManual(planet);
  const [rows, setRows] = useState<SimpleRow[] | null>(null);
  const [today, setToday] = useState<TodayItem[]>([]); // BUSINESS: the day's job (follow-ups due, drafts to check, first messages)
  const src = planet === "business" ? "/api/business" : null; // VAULT has its own shell (VaultPlanet)
  useEffect(() => {
    if (manual || !src) return;
    let live = true;
    fetch(src, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!live) return;
      setRows(!j ? [] : businessRows(j.prospects ?? [], lang));
      if (planet === "business" && Array.isArray(j?.prospects)) setToday(todayQueue(j.prospects as Prospect[], Date.now(), 5));
    }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [manual, src, planet, lang]);
  const habits = useTodayHabits(planet === "life" && !manual);
  const go = (link?: string) => { if (link) location.hash = link.slice(1); else setManual(true); };
  const primary = planet === "business" // the planet's daily job as one button: ORBIT does it (CORE), progress shows in Working on it
    ? { label: t("ph.business.main"), run: () => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: t("ph.business.ex1") } })) } : undefined;
  if (!manual) return <PlanetHome planet={planet} onManual={() => setManual(true)} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} primary={primary}
    results={src ? rows && rows.filter((r) => !today.some((q) => q.id === r.id)).map((r) => ({ ...r, open: () => go(r.link) })) : undefined}>
    {today.length > 0 && <ul className="space-y-2" aria-label={t("bizws.today")}>{today.map((q) => (
      <li key={`${q.kind}:${q.id}`} className={`card ${css.need} ${css.today}`}>
        <span className={css.todayDot} data-kind={q.kind} aria-hidden="true" />
        <span className="min-w-0 flex-1"><b className="block truncate">{q.name}</b><small className="muted">{t(`bizws.q.${q.kind}`)}</small></span>
        <button className="chip shrink-0" onClick={() => go(`#o=business&k=client&id=${encodeURIComponent(q.id)}`)}>{t("common.open")}</button>
      </li>))}</ul>}
    {habits.items.length > 0 && <ul className="space-y-2" aria-label={t("life.tab.Habits")}>{habits.items.map((h) => (
      <li key={h.id} className={`card ${css.need} ${css.habit}`} data-done={h.doneToday || undefined}>
        <button type="button" className={css.check} aria-pressed={h.doneToday} aria-label={h.name} disabled={habits.busy === h.id} onClick={() => habits.toggle(h.id, !h.doneToday)}>
          <span aria-hidden="true">{h.doneToday ? "✓" : ""}</span>
        </button>
        <span className="min-w-0 flex-1"><b className="block truncate">{h.emoji ? `${h.emoji} ` : ""}{h.name}</b>{h.streak > 1 && <small className="muted">{t("ph.life.streak", { n: h.streak })}</small>}</span>
      </li>))}</ul>}
    {habits.err && <p className="error text-sm" role="alert">{habits.err}</p>}
  </PlanetHome>;
  return <><BackToSimple onClick={() => setManual(false)} />{children}</>;
}
