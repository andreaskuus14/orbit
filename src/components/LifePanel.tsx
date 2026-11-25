"use client";
// LIFE planet (design language + MIX look): one calm shell, today first. Main box adds a task to today's plan (locally, never a
// model). Then Needs you (reminders waiting for a "Got it"), Next up, today's habits (one tap), the focus timer (the one moving
// thing), coming reminders and, last, the journal as a quiet private room that opens only on purpose.
// Plan, reminders, week review, habits and school open as sheets from the "…" menu.
// Privacy (#754, unchanged): everything here reads GET /api/life?lite=1 (counts, no journal). The decrypted journal is fetched
// only inside the Journal sheet; past entries start blurred; the region is data-private; the shield refuses desk screenshots
// while LIFE is open; unsaved journal text is kept on this PC when a save fails. Journal text never goes to any model.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlanetShell, Section, Button, Card, Row, Empty, Loading, ErrorState, Sheet, toast, uiSound, type MenuItem } from "@/components/ui";
import { ALL_DAYS, MAX_JOURNAL, MAX_NAME, MAX_REMINDER, MAX_UNIT, addDays, isRepeat, type HabitView, type LifeState } from "@/lib/life-pure";
import { DRAFT_KEY, parseDraft, type LifeLite } from "@/lib/life-private-pure";
import { useLifeShield } from "./useLifeShield";
import { hhmm, nudgeMinute, windowLabel } from "@/lib/habit-nudge-pure";
import type { LifeView } from "@/lib/nav-pure";
import { FOCUS_TIMER_KEY, advanceFocusTimer, focusPhaseSeconds, pickTimer, restoreFocusTimer, workedMinutes, type FocusTimer, type RestoredFocusTimer } from "@/lib/focus-timer-pure";
import { hhmm as clock, type Block, type DayPlan } from "@/lib/dayplan-pure";
import type { WeekReview } from "@/lib/life-week-pure";
import { nextAction, whyKey } from "@/lib/life-plan-pure";
import { useT } from "./i18n";
import CalendarCard from "./CalendarCard";
import SchoolPanel from "./SchoolPanel";
import "@/app/life-planet.css";

async function post<T = Record<string, unknown>>(body: object): Promise<T> {
  const res = await fetch("/api/life", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
type SheetId = "plan" | "reminders" | "review" | "habits" | "school" | "journal";
const SHEET_OF: Record<LifeView, SheetId | null> = { today: null, focus: null, capture: "plan", review: "review", habits: "habits", reminders: "reminders", journal: "journal" };
const loc = (lang: string) => (lang === "et" ? "et-EE" : "en-GB");
const longDate = (k: string, lang: string) => new Date(`${k}T12:00`).toLocaleDateString(loc(lang), { weekday: "long", month: "long", day: "numeric" });
/** Day names from the browser (2024-01-07 is a Sunday), so Estonian gets Estonian names. */
const dayName = (d: number, lang: string, weekday: "long" | "short" | "narrow") => new Date(2024, 0, 7 + d).toLocaleDateString(loc(lang), { weekday });
const when = (iso: string, lang: string) => new Date(iso).toLocaleString(loc(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Tallinn" });
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
type Act = (body: object) => Promise<unknown>;

/** open: a voice/palette request (new object per command), so it applies again even while the drawer is open. */
export default function LifePanel({ open, onClose }: { open?: { tab: LifeView; start?: true } | null; onClose?: () => void }) {
  const { t, lang } = useT();
  useLifeShield("panel"); // desk screenshots are refused while LIFE is open
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setSheet(SHEET_OF[open.tab]);
    if (open.start) startTimer();
    if (open.tab === "focus") focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [st, setSt] = useState<LifeLite | null>(null);
  const [plan, setPlan] = useState<{ plan: DayPlan; review: { text: string } | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const [res, pr] = await Promise.all([fetch("/api/life?lite=1", { cache: "no-store" }), fetch("/api/dayplan").catch(() => null)]);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as LifeLite;
      setSt(json); setFailed(false);
      adoptTimer(json.timer);
      if (pr?.ok) setPlan(await pr.json());
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  /** A LIFE action, then a counts-only refresh. Errors become one plain toast (the data on screen is untouched). */
  const act = useCallback(async (body: object) => {
    try { const r = await post(body); void load(); return r; } catch { uiSound("error"); toast({ tone: "error", text: t("lf.actFailed") }); return null; }
  }, [load, t]);
  const planAct = useCallback(async (body: object) => {
    try {
      const res = await fetch("/api/dayplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, from: "life" }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(res.status));
      void load(); return (json.result ?? true) as unknown;
    } catch { uiSound("error"); toast({ tone: "error", text: t("lf.actFailed") }); return null; }
  }, [load, t]);
  /** One tap on a habit: shown at once, saved in the background, put back (with a note) if the save fails. */
  const check = useCallback(async (h: HabitView, body: { done?: boolean; amount?: number }) => {
    const prev = st;
    setSt((s) => s && { ...s, habits: s.habits.map((x) => x.id !== h.id ? x : { ...x, ...(body.done !== undefined && { doneToday: body.done }), ...(body.amount !== undefined && { amountToday: body.amount, doneToday: !!x.goal && body.amount >= x.goal }) }) });
    try { await post({ action: "check", id: h.id, ...body }); if (body.done) uiSound("toggleOn"); }
    catch { setSt(prev); uiSound("error"); toast({ tone: "error", text: t("lf.checkFailed", { name: h.name }) }); }
  }, [st, t]);
  const [replanning, setReplanning] = useState(false);
  const replan = useCallback(async () => {
    setReplanning(true);
    const r = await fetch("/api/dayplan?fresh=1").catch(() => null);
    if (r?.ok) { setPlan(await r.json()); toast({ text: t("lf.replanned") }); } else toast({ tone: "error", text: t("lf.actFailed") });
    setReplanning(false);
  }, [t]);
  const focusOn = (task: string) => { timer.task = task; startTimer(); setSheet(null); requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: "nearest" })); };
  const openSheet = (s: SheetId) => setSheet(s);
  const close = () => setSheet(null);

  const needs = st ? st.review.unacked.length + st.review.overdue.length : 0;
  const needsBefore = useRef(-1);
  useEffect(() => { if (st && needsBefore.current >= 0 && needs > needsBefore.current) uiSound("needs"); if (st) needsBefore.current = needs; }, [needs, st]);

  const todays = st ? st.habits.filter((h) => h.scheduledToday && !h.off) : [];
  const done = todays.filter((h) => h.doneToday).length;
  const status = st ? t("lf.status", { done, n: todays.length, min: st.focus.today }) : failed ? t("lf.err.title") : t("lf.loading");
  const menu: MenuItem[] = [
    { label: t("lf.s.plan"), onSelect: () => openSheet("plan") },
    { label: t("lf.s.reminders"), onSelect: () => openSheet("reminders") },
    { label: t("lf.s.review"), onSelect: () => openSheet("review") },
    { label: t("lf.s.habits"), onSelect: () => openSheet("habits") },
    { label: t("lf.s.school"), onSelect: () => openSheet("school") },
    "separator",
    { label: t("lf.s.journal"), onSelect: () => openSheet("journal") },
  ];
  const sheets: Record<SheetId, { title: string; body: () => ReactNode }> = {
    plan: { title: t("lf.s.plan"), body: () => st && <PlanSheet plan={plan?.plan ?? null} planAct={planAct} replan={replan} replanning={replanning} focusOn={focusOn} /> },
    reminders: { title: t("lf.s.reminders"), body: () => st && <Reminders st={st} act={act} /> },
    review: { title: t("lf.s.review"), body: () => st && <Review st={st} review={plan?.review ?? null} /> },
    habits: { title: t("lf.s.habits"), body: () => st && <Habits st={st} act={act} /> },
    school: { title: t("lf.s.school"), body: () => <SchoolPanel /> },
    journal: { title: t("lf.s.journal"), body: () => <Journal /> },
  };

  const body = (): ReactNode => {
    if (!st && failed) return <ErrorState title={t("lf.err.title")} text={t("lf.err.text")} retryLabel={t("state.retry")} onRetry={() => void load()} />;
    if (!st) return <Loading rows={4} label={t("lf.loading")} />;
    const upcoming = st.reminders.filter((r) => !r.fired).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 3);
    return <>
      {failed && <p className="lf-note" role="alert">{t("lf.err.stale")} <button className="lf-link" onClick={() => void load()}>{t("state.retry")}</button></p>}
      {needs > 0 && <Section title={t("lf.needs")} count={needs} id="lf-needs">
        <div className="lf-stack">
          {st.review.unacked.map((r) => <Card key={r.id} tone="needs" title={r.text} sub={`${when(r.at, lang)}${r.missed ? ` · ${t("life.missed")}` : ""}`}
            actions={<Button size="sm" variant="secondary" onClick={() => void act({ action: "ack", id: r.id })} label={t("life.ackAria", { text: r.text })}>{t("life.ack")}</Button>} />)}
          {st.review.overdue.map((r) => <Card key={r.id} tone="needs" title={r.text} sub={`${when(r.at, lang)} · ${t("life.overdue")}`} />)}
        </div>
      </Section>}
      <NextUp plan={plan?.plan ?? null} planAct={planAct} focusOn={focusOn} openPlan={() => openSheet("plan")} />
      <Section title={t("lf.habits")} count={todays.length ? undefined : 0} id="lf-habits"
        action={<Button size="sm" variant="ghost" onClick={() => openSheet("habits")}>{t("lf.manage")}</Button>}>
        {todays.length ? <ul className="lf-habits" aria-label={t("lf.habits")}>{todays.map((h) => <HabitLine key={h.id} h={h} check={check} />)}</ul>
          : <Empty title={st.habits.length ? t("lf.noHabitsToday") : t("lf.noHabits")} text={st.habits.length ? undefined : t("lf.noHabitsText")}
            action={st.habits.length ? undefined : <Button size="sm" onClick={() => openSheet("habits")}>{t("lf.addHabit")}</Button>} />}
      </Section>
      <div ref={focusRef}><Section title={t("lf.focusTitle")} id="lf-focus"><Focus st={st} reload={load} /></Section></div>
      <Section title={t("lf.coming")} id="lf-coming" action={<Button size="sm" variant="ghost" onClick={() => openSheet("reminders")}>{t("lf.seeAll")}</Button>}>
        {upcoming.length ? <div className="lf-rows">{upcoming.map((r) => <Row key={r.id} title={r.text} sub={`${when(r.at, lang)}${isRepeat(r.repeat) ? ` · ${t(REPEAT_KEY[r.repeat])}` : ""}`} />)}</div>
          : <Empty title={t("lf.noComing")} text={t("lf.noComingText")} />}
      </Section>
      <section className="lf-journal-door" aria-labelledby="lf-jd">
        <div>
          <h3 id="lf-jd" className="lf-journal-title">{t("lf.journal")}</h3>
          <p className="lf-journal-sub">{st.journalDays ? t("lf.journalDays", { n: st.journalDays }) : t("lf.journalEmpty")}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => openSheet("journal")}>{t("lf.openJournal")}</Button>
      </section>
    </>;
  };

  const sh = sheet ? sheets[sheet] : null;
  return (
    <PlanetShell planet="life" title={t("lf.title")} status={status} className="lf-shell" menu={menu} menuLabel={t("lf.more")}
      onClose={onClose} closeLabel={t("lf.close")} closeClassName="world-back"
      ask={{ label: t("lf.ask"), placeholder: t("lf.askPh"), sendLabel: t("lf.askSend"),
        onSubmit: async (task) => { if (await planAct({ task, min: 30, rank: 2 })) toast({ tone: "done", text: t("life.taskAdded") }); } }}
      sheet={<Sheet open={!!sh} title={sh?.title ?? ""} onClose={close} closeLabel={t("lf.close")}>{sh?.body()}</Sheet>}>
      {body()}
    </PlanetShell>
  );
}

const REPEAT_KEY = { daily: "life.everyDay", weekdays: "life.weekdays", weekly: "life.everyWeek" } as const;

function HabitLine({ h, check }: { h: HabitView; check: (h: HabitView, b: { done?: boolean; amount?: number }) => Promise<void> }) {
  const { t } = useT();
  const sub = [h.unit && t("habit.qtyToday", { n: h.amountToday ?? 0, goal: h.goal ?? 0, unit: h.unit }),
    h.target && t("habit.week", { n: h.weekDone ?? 0, target: h.target }), h.streak > 1 && t("ph.life.streak", { n: h.streak })].filter(Boolean).join(" · ");
  return (
    <li className="lf-habit" data-done={h.doneToday || undefined}>
      <button type="button" className="lf-check" aria-pressed={h.doneToday} aria-label={`${h.name}: ${t(h.doneToday ? "life.markUndone" : "life.markDone")}`}
        onClick={() => void check(h, h.unit ? { amount: h.doneToday ? 0 : h.goal ?? 1 } : { done: !h.doneToday })}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <span className="lf-habit-text"><span className="lf-habit-name">{h.emoji ? `${h.emoji} ` : ""}{h.name}</span>{sub && <span className="lf-habit-sub">{sub}</span>}</span>
      {h.unit && !h.doneToday && <Button size="sm" variant="ghost" label={t("lf.addOneAria", { unit: h.unit, name: h.name })} onClick={() => void check(h, { amount: (h.amountToday ?? 0) + 1 })}>+1</Button>}
      <WeekDots h={h} />
    </li>
  );
}

/** The last 7 days: a quiet strip of dots (filled = done, ring = planned, faint = rest day). */
function WeekDots({ h }: { h: HabitView }) {
  const { t } = useT();
  return (
    <span className="lf-dots" role="img" aria-label={t("lf.dots", { n: h.week.filter((d) => d.done).length })}>
      {h.week.map((d) => <i key={d.date} data-done={d.done || undefined} data-off={!d.scheduled || undefined} />)}
    </span>
  );
}

function NextUp({ plan, planAct, focusOn, openPlan }: { plan: DayPlan | null; planAct: Act; focusOn: (task: string) => void; openPlan: () => void }) {
  const { t } = useT();
  const next = nextAction(plan, nowMin());
  const overrun = async (id: string, title: string) => {
    const r = (await planAct({ overrun: id, min: 15 })) as { moved: string[]; dropped: string[] } | null;
    if (r) toast({ text: `${title}: ${t("life.adjusted", { moved: r.moved.length, dropped: r.dropped.length })}` });
  };
  if (!next) return <Section title={t("lf.next")} id="lf-next"><Empty title={t("lf.nothingNext")} action={<Button size="sm" onClick={openPlan}>{t("lf.s.plan")}</Button>} /></Section>;
  return (
    <Section title={t("lf.next")} id="lf-next" action={<Button size="sm" variant="ghost" onClick={openPlan}>{t("lf.dayPlan")}</Button>}>
      <Card tone="accent" title={next.block.title}
        sub={`${next.now ? t("life.nextNow", { t: clock(next.block.end) }) : t("life.nextAt", { t: clock(next.block.start) })} · ${next.block.source.label}`}
        actions={<>
          {next.now && <Button size="sm" variant="ghost" label={t("life.overrunAria", { title: next.block.title })} onClick={() => void overrun(next.block.id, next.block.title)}>{t("life.overrun")}</Button>}
          <Button size="sm" variant="primary" onClick={() => focusOn(next.block.title)}>{t("life.focusOn")}</Button>
        </>} />
    </Section>
  );
}

function PlanSheet({ plan, planAct, replan, replanning, focusOn }: { plan: DayPlan | null; planAct: Act; replan: () => void; replanning: boolean; focusOn: (task: string) => void }) {
  const { t } = useT();
  const [task, setTask] = useState(""), [min, setMin] = useState("30"), [rank, setRank] = useState("2"), [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || busy) return;
    setBusy(true);
    if (await planAct({ task, min: Number(min), rank: Number(rank), ...(due && { due }) })) { setTask(""); setDue(""); toast({ tone: "done", text: t("life.taskAdded") }); }
    setBusy(false);
  };
  return (
    <div className="lf-stack">
      <form onSubmit={add} className="lf-form" aria-label={t("life.task")}>
        <input className="field w-full" value={task} onChange={(e) => setTask(e.target.value)} placeholder={t("life.taskPh")} aria-label={t("life.task")} maxLength={200} required />
        <div className="lf-form-row">
          <label className="lf-lab">{t("life.estimate")}<input className="field w-20" type="number" min={10} max={240} step={5} value={min} onChange={(e) => setMin(e.target.value)} /></label>
          <label className="lf-lab">{t("life.priority")}<select className="field" value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="1">{t("life.prio1")}</option><option value="2">{t("life.prio2")}</option><option value="3">{t("life.prio3")}</option>
          </select></label>
          <label className="lf-lab">{t("life.due")}<input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <Button type="submit" variant="primary" busy={busy} disabled={!task.trim()}>{t("common.add")}</Button>
        </div>
      </form>
      {!plan ? <Empty title={t("lf.noPlan")} /> : <>
        <div className="lf-plan-head">
          <p className="lf-note">{plan.load ? t("life.load", { planned: plan.load.plannedMin, cap: plan.load.capMin, free: plan.load.freeMin }) : ""}</p>
          <span className="lf-plan-actions">
            <Button size="sm" variant="ghost" busy={replanning} onClick={replan}>{t("life.replan")}</Button>
            {!plan.accepted ? <Button size="sm" variant="primary" onClick={() => void planAct({ accept: true })}>{t("life.accept")}</Button> : <span className="lf-note">{t("lf.accepted")}</span>}
          </span>
        </div>
        {plan.blocks.length ? <ol className="lf-timeline" aria-label={t("life.plan")}>
          {plan.blocks.map((b) => (
            <li key={b.id} data-fixed={!b.flexible || undefined} data-done={b.done || undefined}>
              <span className="lf-time pu-num">{clock(b.start)}<br />{clock(b.end)}</span>
              <span className="lf-block">
                <span className="lf-block-title">{b.title}</span>
                <Why b={b} />
                {b.flexible && !b.done && <span className="lf-block-actions">
                  <Button size="sm" variant="ghost" onClick={() => focusOn(b.title)}>{t("life.focusOn")}</Button>
                  <Defer id={b.id} title={b.title} planAct={planAct} />
                </span>}
              </span>
            </li>
          ))}
        </ol> : <Empty title={t("lf.planEmpty")} />}
        {plan.unplaced.length > 0 && <Section title={t("life.unscheduled")} count={plan.unplaced.length}>
          <div className="lf-rows">{plan.unplaced.map((u) => <Row key={u.id} title={u.title} sub={t(whyKey(u))} trail={<Defer id={u.id} title={u.title} planAct={planAct} />} />)}</div>
        </Section>}
      </>}
      <CalendarCard />
    </div>
  );
}

function Review({ st, review }: { st: LifeLite; review: { text: string } | null }) {
  const { t } = useT();
  return (
    <div className="lf-stack">
      <WeekCard />
      <Section title={t("life.reviewDay")}><p className="lf-text">{review?.text ?? <span className="lf-note">{t("life.notAccepted")}</span>}</p></Section>
      <Section title={t("life.worked")}>
        {st.work.length ? <div className="lf-rows">{st.work.map((w) => <Row key={w.task} title={w.task} trail={<span className="pu-num">{t("life.min", { n: w.min })}</span>} />)}</div>
          : <Empty title={t("life.noWork")} />}
      </Section>
    </div>
  );
}

function Habits({ st, act }: { st: LifeLite; act: Act }) {
  const { t, lang } = useT();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [sure, setSure] = useState<string | null>(null); // two-step delete instead of the browser's confirm()
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !days.length) return;
    if (await act({ action: "addHabit", name, emoji: emoji || undefined, days })) { setName(""); setEmoji(""); setDays(ALL_DAYS); toast({ tone: "done", text: t("lf.habitAdded") }); }
  };
  const daysText = (h: HabitView) => h.days.length === 7 ? t("life.everyDay") : h.days.map((d) => dayName(d, lang, "short")).join(", ");
  return (
    <div className="lf-stack">
      <form onSubmit={add} className="lf-form">
        <div className="lf-form-row">
          <input className="field w-14 text-center" value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label={t("life.emoji")} maxLength={8} />
          <input className="field flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("life.habitPh")} aria-label={t("life.habitName")} maxLength={MAX_NAME} required />
        </div>
        <div className="lf-form-row" role="group" aria-label={t("life.days")}>
          {ALL_DAYS.map((d) => (
            <button key={d} type="button" className="pu-chip" aria-pressed={days.includes(d)} aria-label={dayName(d, lang, "long")}
              onClick={() => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort())}>{dayName(d, lang, "narrow")}</button>
          ))}
          <Button type="submit" variant="primary" disabled={!name.trim() || !days.length || st.habits.length >= 30}>{t("common.add")}</Button>
        </div>
        {st.habits.length >= 30 && <p className="lf-note">{t("life.max")}</p>}
      </form>
      {!st.habits.length && <Empty title={t("lf.noHabits")} text={t("lf.noHabitsText")} />}
      <ul className="lf-stack">
        {st.habits.map((h) => (
          <li key={h.id} className="lf-card">
            <div className="lf-form-row">
              <span className="lf-habit-text">
                <span className="lf-habit-name">{h.emoji ? `${h.emoji} ` : ""}{h.name}</span>
                <span className="lf-habit-sub">{[daysText(h), h.streak > 1 && t("ph.life.streak", { n: h.streak }), h.window && h.nudge && t("habit.nudgeAt", { t: hhmm(nudgeMinute(h, st.today)!) }).replace(/^\s*·\s*/, "")].filter(Boolean).join(" · ")}</span>
                <span className="lf-habit-sub">{[h.target && t("habit.week", { n: h.weekDone ?? 0, target: h.target }), h.unit && t("habit.qtyToday", { n: h.amountToday ?? 0, goal: h.goal ?? 0, unit: h.unit }),
                  pausedTill(h, st.today) ? t("habit.paused", { d: pausedTill(h, st.today)! }) : h.off && t("habit.offToday"), h.trend && t(`habit.trend.${h.trend}`)].filter(Boolean).join(" · ")}</span>
              </span>
              {sure === h.id
                ? <span className="lf-plan-actions"><Button size="sm" variant="ghost" onClick={() => setSure(null)}>{t("lf.keep")}</Button><Button size="sm" variant="danger" onClick={() => { setSure(null); void act({ action: "removeHabit", id: h.id }); }}>{t("lf.deleteYes")}</Button></span>
                : <Button size="sm" variant="ghost" onClick={() => setSure(h.id)} label={t("life.deleteAria", { name: h.name })}>{t("rules.delete")}</Button>}
            </div>
            {sure === h.id && <p className="lf-note" role="alert">{t("life.deleteHabit", { name: h.name })}</p>}
            <NudgeEdit key={`${h.window?.from}-${h.window?.to}-${h.nudge}`} h={h} act={act} />
            <PlanEdit key={`${h.target}-${h.unit}-${h.goal}`} h={h} today={st.today} act={act} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Habit engine: when (“evening 19–22”, “after lunch”, “on Mondays”) and how ORBIT nudges it. It learns the minute from his check-ins. */
function NudgeEdit({ h, act }: { h: HabitView; act: Act }) {
  const { t } = useT();
  const [when, setWhen] = useState(h.window ? windowLabel(h.window) : "");
  const [channel, setChannel] = useState<string>(h.nudge ?? "off");
  return (
    <form className="lf-form-row" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "nudge", id: h.id, when, channel })) toast({ tone: "done", text: t("lf.saved") }); }}>
      <input className="field flex-1" value={when} onChange={(e) => setWhen(e.target.value)} maxLength={60}
        placeholder={t("habit.when")} aria-label={t("habit.whenAria", { name: h.name })} />
      <select className="field" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t("habit.howAria", { name: h.name })}>
        <option value="off">{t("habit.off")}</option><option value="toast">{t("habit.toast")}</option><option value="push">{t("habit.push")}</option>
      </select>
      <Button size="sm" type="submit">{t("habit.save")}</Button>
    </form>
  );
}

const pausedTill = (h: HabitView, today: string) => h.pauses?.find((p) => p.from <= today && p.to >= today)?.to;

/** LIF04: times a week, a daily amount with its unit, a pause (holiday, illness) or a rest day today. None of these break a streak. */
function PlanEdit({ h, today, act }: { h: HabitView; today: string; act: Act }) {
  const { t } = useT();
  const [target, setTarget] = useState(h.target ? String(h.target) : ""), [unit, setUnit] = useState(h.unit ?? ""), [goal, setGoal] = useState(h.goal ? String(h.goal) : "");
  const [pause, setPause] = useState({ from: today, to: addDays(today, 6) });
  const resting = !!h.rest?.includes(today), paused = pausedTill(h, today);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act({ action: "habitPlan", id: h.id, target: target ? Number(target) : null, ...(unit.trim() && goal ? { unit, goal: Number(goal) } : h.unit ? { unit: null } : {}) })) toast({ tone: "done", text: t("lf.saved") });
  };
  return (
    <details className="lf-details">
      <summary>{t("habit.more")}</summary>
      <form className="lf-form-row" onSubmit={save}>
        <input className="field w-20" type="number" min={1} max={7} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t("habit.target")} aria-label={t("habit.targetAria", { name: h.name })} />
        <input className="field w-28" value={unit} maxLength={MAX_UNIT} onChange={(e) => setUnit(e.target.value)} placeholder={t("habit.unit")} aria-label={t("habit.unit")} />
        <input className="field w-20" type="number" min={0} step="any" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("habit.goal")} aria-label={t("habit.goal")} />
        <Button size="sm" type="submit">{t("habit.save")}</Button>
      </form>
      <div className="lf-form-row">
        <Button size="sm" variant="ghost" aria-pressed={resting} onClick={() => void act({ action: "habitPlan", id: h.id, rest: today })}>{t(resting ? "habit.restUndo" : "habit.restToday")}</Button>
        {paused ? <Button size="sm" variant="ghost" onClick={() => void act({ action: "habitPlan", id: h.id, pause: null })}>{t("habit.resume")}</Button> : <>
          <input className="field" type="date" value={pause.from} onChange={(e) => setPause({ ...pause, from: e.target.value })} aria-label={t("habit.pauseFrom")} />
          <input className="field" type="date" value={pause.to} onChange={(e) => setPause({ ...pause, to: e.target.value })} aria-label={t("habit.pauseTo")} />
          <Button size="sm" variant="ghost" onClick={() => void act({ action: "habitPlan", id: h.id, pause })}>{t("habit.pause")}</Button>
        </>}
      </div>
    </details>
  );
}

/** LIF13: why the block is here, how long and whose estimate, its deadline and where it came from. */
function Why({ b }: { b: Block }) {
  const { t } = useT();
  if (!b.why || b.source.kind === "break" || b.source.kind === "personal") return <span className="lf-block-sub">{t(b.flexible ? "life.suggested" : "life.fixed")}</span>;
  const w = b.why;
  return <span className="lf-block-sub">{[t(`life.r.${w.r}`), `${b.end - b.start} min (${t(`life.est.${w.est}`)})`, w.due && t("life.dueOn", { d: w.due }), b.source.label].filter(Boolean).join(" · ")}</span>;
}

/** "Not today": out of plans until tomorrow (or next week); the same task isn't suggested again before then. */
function Defer({ id, title, planAct }: { id: string; title: string; planAct: Act }) {
  const { t } = useT();
  return (
    <>
      <Button size="sm" variant="ghost" label={t("life.deferAria", { title })} onClick={() => void planAct({ defer: id, until: "tomorrow" })}>{t("life.defer")}</Button>
      <Button size="sm" variant="ghost" label={t("life.deferWeekAria", { title })} onClick={() => void planAct({ defer: id, until: "week" })}>{t("life.deferWeek")}</Button>
    </>
  );
}

/** LIF08: the last 7 days from local data (never the journal). Gaps are named, not filled in. */
function WeekCard() {
  const { t } = useT();
  const [r, setR] = useState<WeekReview | null>(null), [err, setErr] = useState(false);
  const load = async () => {
    setErr(false);
    try { const res = await fetch("/api/life?week=1"); if (!res.ok) throw new Error(String(res.status)); setR(await res.json()); }
    catch { setErr(true); }
  };
  useEffect(() => { void load(); }, []);
  if (!r) return err ? <ErrorState title={t("lf.weekErr")} text={t("lf.safe")} retryLabel={t("state.retry")} onRetry={() => void load()} /> : <Loading rows={3} label={t("lf.loading")} />;
  const o = r.outcomes, a = r.adjust;
  return (
    <section className="lf-stack" aria-label={t("life.wk.title", { from: r.from, to: r.to })}>
      <div className="lf-trio">
        <Stat label={t("lf.wk.tasks")} value={r.accuracy ? `${o.tasksDone}/${o.tasksPlanned}` : "–"} />
        <Stat label={t("lf.wk.focus")} value={t("life.min", { n: o.focusMin })} />
        <Stat label={t("lf.wk.habits")} value={o.habitsDue ? `${o.habitsDone}/${o.habitsDue}` : "–"} />
      </div>
      {o.schoolDone.length > 0 && <p className="lf-text">{t("life.wk.school", { list: o.schoolDone.join(", ") })}</p>}
      {r.accuracy && <p className="lf-text"><span className="lf-note">{t("life.wk.accuracy")}:</span> {t("life.wk.acc", { pct: r.accuracy.pct, done: r.accuracy.doneMin, planned: r.accuracy.plannedMin, days: r.accuracy.days })}</p>}
      <div className="lf-text"><span className="lf-note">{t("life.wk.friction")}:</span> {r.friction.length ? <ul className="list-disc pl-4">{r.friction.map((f) => <li key={f.title}>{t("life.wk.fr", { title: f.title, d: f.deferred, m: f.missed })}</li>)}</ul> : t("life.wk.noFriction")}</div>
      <p className="lf-text"><span className="lf-note">{t("life.wk.adjust")}:</span> {a ? t(`life.wk.adj.${a.suggest}`, { name: a.name, pct: Math.round(a.rate * 100) }) : t("life.wk.noAdjust")}</p>
      {r.missing.length > 0 && <p className="lf-note">{t("life.wk.missing", { list: r.missing.map((m) => t(`life.wk.m.${m}`)).join(", ") })}</p>}
      <p className="lf-note">{t("life.wk.private")}</p>
    </section>
  );
}
const Stat = ({ label, value }: { label: string; value: string }) => <div className="lf-stat"><span className="lf-stat-num pu-num">{value}</span><span className="lf-note">{label}</span></div>;

/* ---------------- Focus timer ---------------- */
// Module scope keeps the tick alive when the drawer closes; localStorage also survives reloads.
function readTimer() {
  try { return typeof window === "undefined" ? null : localStorage.getItem(FOCUS_TIMER_KEY); } catch { return null; }
}
const restored = restoreFocusTimer(readTimer(), Date.now());
const timer = restored.timer;
const phaseLen = (p: typeof timer.phase) => focusPhaseSeconds(timer.plan, p);
function saveTimer() {
  timer.at = Date.now();
  try { localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify(timer)); } catch { /* storage unavailable: keep the in-memory timer */ }
  post({ action: "timer", timer }).catch(() => {}); // for the read-only second screen
}
const timerListeners = new Set<(logged?: boolean) => void>();
let timerTick: ReturnType<typeof setInterval> | null = null;
// The tick lives at module scope too, so a session finishes (beep + logged minutes) even with the drawer or Focus tab closed.
function applyTimer(result: RestoredFocusTimer) {
  Object.assign(timer, result.timer);
  saveTimer(); // Claim completion before posting: another reload must not log the same focus twice.
  if (result.expired) {
    beep();
    if (result.completedMinutes) post({ action: "focus", minutes: result.completedMinutes, ...(timer.task && { task: timer.task }) }).then(() => timerListeners.forEach((f) => f(true)), () => {});
  }
}
/** Tells the galaxy (ambient focus mode) whether a focus session is running; only on change. */
let focusWas = false;
function focusSignal() {
  const on = timer.endAt > 0 && timer.phase === "focus";
  if (on !== focusWas) { focusWas = on; dispatchEvent(new CustomEvent("orbit:focus", { detail: { on } })); }
}
function ensureTick() {
  if (timerTick) return;
  timerTick = setInterval(() => {
    if (timer.endAt && Date.now() >= timer.endAt) {
      applyTimer(advanceFocusTimer(timer, Date.now()));
    }
    focusSignal();
    if (!timer.endAt && timerTick) { clearInterval(timerTick); timerTick = null; }
    timerListeners.forEach((f) => f());
  }, 500);
}

/** Device switch (LIF05): the server's copy wins when it changed later than this device's; never re-saved, so it can't loop. */
function adoptTimer(remote: FocusTimer | null) {
  const pick = pickTimer(timer, remote);
  if (pick === timer) return;
  Object.assign(timer, pick); if (!pick.task) delete timer.task;
  try { localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify(timer)); } catch { /* in memory only */ }
  focusSignal(); if (timer.endAt) ensureTick();
  timerListeners.forEach((f) => f());
}

/** The Start button's logic; a running timer is left alone. */
function startTimer() {
  if (timer.endAt) return;
  timer.endAt = Date.now() + timer.left * 1000;
  saveTimer();
  focusSignal();
  ensureTick();
}

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 660; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch { /* no audio available */ }
}

if (typeof window !== "undefined") {
  applyTimer(restored);
  if (timer.endAt) ensureTick(); // resume even before the Focus tab is opened; the first tick emits focusSignal
}


/** The focus timer: the one thing on LIFE that moves. Plain <button>s (tests/focus-timer-ui.test.ts presses them by label). */
function Focus({ st, reload }: { st: LifeLite; reload: () => Promise<void> }) {
  const { t } = useT();
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const len = phaseLen;
  const running = timer.endAt > 0;
  const left = running ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)) : timer.left;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const f = (logged?: boolean) => { if (logged) { void reloadRef.current(); toast({ tone: "done", text: t("lf.focusDone") }); } rerender(); }; // logged: a session's minutes were saved
    timerListeners.add(f);
    if (timer.endAt) ensureTick();
    return () => { timerListeners.delete(f); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { startTimer(); rerender(); };
  const pause = () => { timer.left = left; timer.endAt = 0; saveTimer(); focusSignal(); rerender(); };
  const stop = () => { // logs the minutes actually worked on this session's task, then resets
    const m = workedMinutes(timer, Date.now());
    if (m >= 1) post({ action: "focus", minutes: m, ...(timer.task && { task: timer.task }) }).then(() => reloadRef.current(), () => {});
    reset();
  };
  const reset = (plan = timer.plan) => { timer.plan = plan; timer.phase = "focus"; timer.endAt = 0; timer.left = len("focus"); saveTimer(); focusSignal(); rerender(); };
  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  const total = len(timer.phase) || 1, frac = Math.min(1, Math.max(0, 1 - left / total));
  return (
    <div className="lf-focus" data-running={running || undefined} data-phase={timer.phase}>
      <div className="lf-focus-top">
        <div>
          <div className="lf-focus-phase">{timer.phase === "focus" ? (timer.task || t("lf.focusing")) : t("life.break")}</div>
          <div className="lf-focus-time pu-num" role="timer" aria-live="off">{mmss}</div>
        </div>
        <div className="lf-focus-plan" role="group" aria-label={t("life.timerLen")}>
          {([25, 50] as const).map((p) => (
            <button key={p} type="button" className="pu-chip" aria-pressed={timer.plan === p} aria-label={t("lf.planAria", { focus: p, rest: p / 5 })} onClick={() => reset(p)}>{p}/{p / 5}</button>
          ))}
        </div>
      </div>
      <div className="lf-bar" aria-hidden="true"><i style={{ transform: `scaleX(${frac})` }} /></div>
      <input className="field w-full" value={timer.task ?? ""} maxLength={120} aria-label={t("life.focusTask")} placeholder={t("life.focusTaskPh")}
        onChange={(e) => { if (e.target.value) timer.task = e.target.value; else delete timer.task; rerender(); }} onBlur={saveTimer} />
      <div className="lf-focus-actions">
        {running ? <button type="button" className="pu-btn" data-variant="primary" data-size="md" onClick={pause}>{t("rules.pause")}</button>
          : <button type="button" className="pu-btn" data-variant="primary" data-size="md" onClick={start}>{t("life.start")}</button>}
        {timer.phase === "focus" && workedMinutes(timer, Date.now()) >= 1 && <button type="button" className="pu-btn" data-variant="secondary" data-size="md" onClick={stop}>{t("life.stop")}</button>}
        <button type="button" className="pu-btn" data-variant="ghost" data-size="md" onClick={() => reset()}>{t("life.reset")}</button>
        <span className="lf-note lf-focus-today">{t("lf.focusToday", { min: st.focus.today, week: st.focus.week })}</span>
      </div>
    </div>
  );
}

/* ---------------- Reminders ---------------- */
function Reminders({ st, act }: { st: LifeLite; act: Act }) {
  const { t, lang } = useT();
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [repeat, setRepeat] = useState("");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = new Date(at); // datetime-local is this device's local time; the server keeps its Europe/Tallinn wall clock
    if (!text.trim() || isNaN(d.getTime())) return;
    if (await act({ action: "addReminder", text, at: d.toISOString(), ...(repeat ? { repeat } : {}) })) { setText(""); setAt(""); setRepeat(""); toast({ tone: "done", text: t("lf.remAdded") }); }
  };
  const list = useMemo(() => [...st.reminders].sort((a, b) => Number(!!a.fired) - Number(!!b.fired) || a.at.localeCompare(b.at)), [st.reminders]);
  return (
    <div className="lf-stack">
      <form onSubmit={add} className="lf-form">
        <input className="field w-full" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("life.remindPh")} aria-label={t("life.remindText")} maxLength={MAX_REMINDER} required />
        <div className="lf-form-row">
          <input className="field flex-1" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t("life.remindAt")} required />
          <select className="field" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label={t("life.repeat")}>
            <option value="">{t("life.once")}</option><option value="daily">{t("life.everyDay")}</option><option value="weekdays">{t("life.weekdays")}</option><option value="weekly">{t("life.everyWeek")}</option>
          </select>
          <Button type="submit" variant="primary" disabled={!text.trim() || !at}>{t("common.add")}</Button>
        </div>
        <p className="lf-note">{t("life.tz")}</p>
      </form>
      {perm === "default" && <Button size="sm" variant="ghost" onClick={async () => setPerm(await Notification.requestPermission())}>{t("life.notify")}</Button>}
      {list.length ? <div className="lf-rows">{list.map((r) => (
        <Row key={r.id} title={r.text}
          sub={[when(r.at, lang), r.fired && t("lf.shown"), isRepeat(r.repeat) && t(REPEAT_KEY[r.repeat])].filter(Boolean).join(" · ")}
          trail={<Button size="sm" variant="ghost" onClick={() => void act({ action: "removeReminder", id: r.id })} label={t("life.deleteReminder", { text: r.text })}>{t("rules.delete")}</Button>} />
      ))}</div> : <Empty title={t("lf.noComing")} text={t("lf.noComingText")} />}
    </div>
  );
}

/* ---------------- Journal ---------------- */
// The decrypted journal is fetched only here, when the Journal sheet opens (the rest of LIFE uses ?lite=1). Past entries and
// notes stay blurred until clicked, and the region is marked data-private so capture tools can blank it. Today's entry saves by
// itself a moment after he stops typing; if a save fails the text stays on this PC (DRAFT_KEY) and comes back next time.
const keepDraft = (date: string, text: string) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ date, text })); } catch { /* private mode */ } };
const dropDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ } };
const AUTOSAVE_MS = 1200;

function Journal() {
  const { t } = useT();
  const [st, setSt] = useState<LifeState | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await fetch("/api/life", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setSt((await r.json()) as LifeState);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (failed) return <ErrorState title={t("lf.journalErr")} text={t("lf.journalSafe")} retryLabel={t("state.retry")} onRetry={() => void load()} />;
  if (!st) return <Loading rows={3} label={t("lf.journalLoading")} />;
  return <JournalBody st={st} />;
}

type SaveState = "idle" | "saving" | "saved" | "kept";
function JournalBody({ st }: { st: LifeState }) {
  const { t, lang } = useT();
  const today = st.journal[0];
  const [text, setText] = useState(() => { let d: string | null = null; try { d = parseDraft(localStorage.getItem(DRAFT_KEY), today.date); } catch { /* private mode */ } return d ?? today.text; });
  const [state, setState] = useState<SaveState>("idle");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const show = (k: string) => setShown((s) => new Set(s).add(k));
  const base = useRef(today.text); // what the server has
  const latest = useRef({ text, date: today.date });
  latest.current = { text, date: today.date };
  const save = useCallback(async () => {
    const { text: v, date } = latest.current;
    if (v === base.current) return;
    keepDraft(date, v); setState("saving");
    try { await post({ action: "journal", text: v, date }); base.current = v; dropDraft(); setState(latest.current.text === v ? "saved" : "idle"); }
    catch { setState("kept"); }
  }, []);
  useEffect(() => { // autosave a moment after typing stops
    if (text === base.current) return;
    const id = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [text, save]);
  // Closing the sheet or drawer while typing: save what's there on the way out; if that fails it stays on this PC.
  useEffect(() => () => {
    const l = latest.current;
    if (l.text === base.current) return;
    keepDraft(l.date, l.text);
    post({ action: "journal", text: l.text, date: l.date }).then(dropDraft, () => toast({ tone: "error", text: t("life.saveKept") }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const Hidden = ({ k, children }: { k: string; children: string }) => shown.has(k)
    ? <p className="lf-entry-text">{children}</p>
    : <button type="button" className="lf-hidden" onClick={() => show(k)}>
        <span className="lf-blur" aria-hidden="true">{children.slice(0, 160)}</span>
        <span className="lf-note">{t("life.hiddenEntry")}</span>
      </button>;
  const past = st.journal.slice(1).filter((j) => j.text);
  const label = { idle: `${text.length}/${MAX_JOURNAL}`, saving: t("lf.saving"), saved: t("lf.saved"), kept: "" }[state];
  return (
    <div className="lf-stack lf-journal" data-private>
      <p className="lf-private">{t("life.journalPrivate")}</p>
      <label className="lf-today-entry">
        <span className="lf-entry-head"><span>{longDate(today.date, lang)}</span><span className="lf-note" aria-live="polite">{label}</span></span>
        <textarea className="lf-journal-text" value={text} onChange={(e) => { setText(e.target.value); if (state !== "kept") setState("idle"); }} onBlur={() => void save()}
          maxLength={MAX_JOURNAL} placeholder={t("lf.journalPh")} />
        {state === "kept" && <span className="lf-kept" role="alert">{t("life.saveKeptHere")} <button type="button" className="lf-link" onClick={() => void save()}>{t("state.retry")}</button></span>}
      </label>
      {past.length > 0 && <Section title={t("lf.earlier")}>
        <ul className="lf-stack">{past.map((j) => (
          <li key={j.date} className="lf-entry"><div className="lf-note">{longDate(j.date, lang)}</div><Hidden k={`j:${j.date}`}>{j.text}</Hidden></li>
        ))}</ul>
      </Section>}
      {!!st.notes?.length && <Section title={t("life.notes")}>
        <ul className="lf-stack">{st.notes.map((n) => (
          <li key={n.id} className="lf-entry"><div className="lf-note">{longDate(n.date.slice(0, 10), lang)}</div><Hidden k={`n:${n.id}`}>{n.text}</Hidden></li>
        ))}</ul>
      </Section>}
    </div>
  );
}
