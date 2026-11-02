"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import StateNote from "./StateNote";
import { ALL_DAYS, MAX_JOURNAL, MAX_NAME, MAX_REMINDER, MAX_UNIT, REPEAT_LABEL, addDays, isRepeat, type HabitView, type LifeState } from "@/lib/life-pure";
import { hhmm, nudgeMinute, windowLabel } from "@/lib/habit-nudge-pure";
import type { LifeView } from "@/lib/nav-pure";
import { FOCUS_TIMER_KEY, advanceFocusTimer, focusPhaseSeconds, pickTimer, restoreFocusTimer, workedMinutes, type FocusTimer, type RestoredFocusTimer } from "@/lib/focus-timer-pure";
import { hhmm as clock, type Block, type DayPlan } from "@/lib/dayplan-pure";
import type { WeekReview } from "@/lib/life-week-pure";
import { nextAction, whyKey } from "@/lib/life-plan-pure";
import { useT } from "./i18n";
import WorkspaceFrame, { useWorkspaceView, type View } from "./WorkspaceFrame";
import CalendarCard from "./CalendarCard";
import SchoolPanel from "./SchoolPanel";

// LIFE workspace: Today (plan timeline + next action), Capture (tasks, reminders), Review, then Habits/Focus/Journal/School.
// Data via /api/life and the existing day planner (/api/dayplan). Journal text stays on this device's ORBIT: never sent to a model.

async function post<T = Record<string, unknown>>(body: object): Promise<T> {
  const res = await fetch("/api/life", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Tab = "today" | "capture" | "review" | "habits" | "focus" | "journal" | "school";
const TAB_OF: Record<LifeView, Tab> = { today: "today", capture: "capture", review: "review", habits: "habits", focus: "focus", reminders: "capture", journal: "journal" };
const longDate = (k: string) => new Date(`${k}T12:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** open: a voice/palette request (new object per command), so it applies again even while the drawer is open. */
export default function LifePanel({ open }: { open?: { tab: LifeView; start?: true } | null }) {
  const { t: tr } = useT();
  const views: View<Tab>[] = [
    { id: "today", label: tr("life.tab.Today") }, { id: "capture", label: tr("life.tab.Capture") }, { id: "review", label: tr("life.tab.Review") },
    { id: "habits", label: tr("life.tab.Habits"), secondary: true }, { id: "focus", label: tr("life.tab.Focus"), secondary: true },
    { id: "journal", label: tr("life.tab.Journal"), secondary: true }, { id: "school", label: tr("life.tab.School"), secondary: true },
  ];
  const [tab, setTab] = useWorkspaceView<Tab>("life", views);
  useEffect(() => { if (!open) return; setTab(TAB_OF[open.tab]); if (open.start) startTimer(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [st, setSt] = useState<LifeState | null>(null);
  const [plan, setPlan] = useState<{ plan: DayPlan; review: { text: string } | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [res, pr] = await Promise.all([fetch("/api/life"), fetch("/api/dayplan").catch(() => null)]);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setSt(json as LifeState); setErr(null);
      adoptTimer((json as LifeState).timer);
      if (pr?.ok) setPlan(await pr.json());
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (body: object) => {
    try { const r = await post(body); setErr(null); await load(); return r; } catch (e) { setErr((e as Error).message); return null; }
  }, [load]);
  const planAct = useCallback(async (body: object) => {
    try {
      const res = await fetch("/api/dayplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setErr(null); await load(); return json.result as unknown;
    } catch (e) { setErr((e as Error).message); return null; }
  }, [load]);
  const replan = useCallback(async () => { const r = await fetch("/api/dayplan?fresh=1").catch(() => null); if (r?.ok) setPlan(await r.json()); }, []);
  const focusOn = (task: string) => { timer.task = task; startTimer(); setTab("focus"); };

  return (
    <WorkspaceFrame planet="life" title={tr("planet.life")} views={views} view={tab} onView={setTab}
      context={st && tr("life.ctx", { date: longDate(st.today), min: st.focus.today })}
      action={tab === "today" ? <button className="chip" onClick={replan}>{tr("life.replan")}</button> : undefined}>
      {err ? <StateNote state="failed" what={err} kept={st ? tr("state.keptScreen") : undefined} action={{ label: tr("state.retry"), run: () => void load() }} />
        : !st && <StateNote state="loading" action={{ label: tr("state.retry"), run: () => void load() }} />}
      {st && <>
        {tab === "today" && <Today st={st} act={act} plan={plan?.plan ?? null} planAct={planAct} focusOn={focusOn} />}
        {tab === "capture" && <Capture st={st} act={act} planAct={planAct} />}
        {tab === "review" && <Review st={st} act={act} review={plan?.review ?? null} />}
        {tab === "habits" && <Habits st={st} act={act} />}
        {tab === "focus" && <Focus st={st} reload={load} />}
        {tab === "journal" && <Journal st={st} act={act} />}
        {tab === "school" && <SchoolPanel />}
      </>}
    </WorkspaceFrame>
  );
}

type Act = (body: object) => Promise<unknown>;

function Dots({ h }: { h: HabitView }) {
  return (
    <span className="flex gap-1" aria-label={`Last 7 days: ${h.week.filter((d) => d.done).length} done`}>
      {h.week.map((d) => (
        <span key={d.date} title={`${d.date}${d.done ? " ✓" : d.scheduled ? "" : " (rest day)"}`}
          style={{ width: 7, height: 7, borderRadius: 99, background: d.done ? "var(--mint)" : "transparent", border: `1px solid ${d.scheduled ? "var(--mint)" : "rgba(255,255,255,0.15)"}` }} />
      ))}
    </span>
  );
}

type PlanAct = (body: object) => Promise<unknown>;

function Today({ st, act, plan, planAct, focusOn }: { st: LifeState; act: Act; plan: DayPlan | null; planAct: PlanAct; focusOn: (task: string) => void }) {
  const { t } = useT();
  const [note, setNote] = useState<string | null>(null);
  const todays = st.habits.filter((h) => h.scheduledToday);
  const next = nextAction(plan, nowMin());
  const overrun = async (id: string, title: string) => {
    const r = (await planAct({ overrun: id, min: 15 })) as { moved: string[]; dropped: string[] } | null;
    if (r) setNote(`${title}: ${t("life.adjusted", { moved: r.moved.length, dropped: r.dropped.length })}`);
  };
  return (
    <div className="space-y-3">
      <div className="card space-y-1" aria-live="polite">
        <div className="muted text-[11px] uppercase tracking-widest">{t("life.next")}</div>
        {next ? <>
          <b className="block">{next.block.title}</b>
          <span className="muted text-xs">{next.now ? t("life.nextNow", { t: clock(next.block.end) }) : t("life.nextAt", { t: clock(next.block.start) })} · {next.block.source.label}</span>
          <div className="flex gap-1.5 pt-1">
            <button className="btn" onClick={() => focusOn(next.block.title)}>{t("life.focusOn")}</button>
            {next.now && <button className="chip" aria-label={t("life.overrunAria", { title: next.block.title })} onClick={() => overrun(next.block.id, next.block.title)}>{t("life.overrun")}</button>}
          </div>
        </> : <p className="muted text-sm">{t("life.nothingNext")}</p>}
        {note && <p className="muted text-xs">{note}</p>}
      </div>
      {plan && (
        <section className="card space-y-2" aria-label={t("life.plan")}>
          <div className="flex items-baseline justify-between gap-2">
            <b>{t("life.plan")}</b>
            {!plan.accepted && <button className="chip" onClick={() => planAct({ accept: true })}>{t("life.accept")}</button>}
          </div>
          {plan.load && <p className="muted text-xs">{t("life.load", { planned: plan.load.plannedMin, cap: plan.load.capMin, free: plan.load.freeMin })}</p>}
          <ol className="space-y-1 text-sm">
            {plan.blocks.map((b) => (
              <li key={b.id} className="flex gap-2" style={b.flexible ? undefined : { opacity: 0.75 }}>
                <span className="font-mono text-xs muted w-24 shrink-0">{clock(b.start)}–{clock(b.end)}</span>
                <span className="flex-1">{b.done ? "✓ " : ""}{b.title}<Why b={b} /></span>
                <span className="muted text-xs">{t(b.flexible ? "life.suggested" : "life.fixed")}</span>
                {b.flexible && !b.done && <Defer id={b.id} title={b.title} planAct={planAct} />}
              </li>
            ))}
          </ol>
          {plan.unplaced.length > 0 && <>
            <div className="muted text-[11px] uppercase tracking-widest pt-1">{t("life.unscheduled")}</div>
            <ul className="space-y-1 text-sm">{plan.unplaced.map((u) => <li key={u.id} className="flex gap-2"><span className="flex-1">{u.title} <span className="muted text-xs">· {t(whyKey(u))}</span></span><Defer id={u.id} title={u.title} planAct={planAct} /></li>)}</ul>
          </>}
        </section>
      )}
      <ul className="space-y-2">
        {todays.map((h) => (
          <li key={h.id} className="card flex items-center gap-3 text-sm">
            <button className="chip" aria-pressed={h.doneToday} aria-label={`${h.name}: ${t(h.doneToday ? "life.markUndone" : "life.markDone")}`}
              onClick={() => act({ action: "check", id: h.id, done: !h.doneToday })}>{h.doneToday ? "✓" : "○"}</button>
            <span className="flex-1">{h.emoji} {h.name}{h.target ? <span className="muted text-xs"> · {t("habit.week", { n: h.weekDone ?? 0, target: h.target })}</span> : null}</span>
            {h.unit && <Amount h={h} act={act} />}
            <span className="muted text-xs" title={t("life.streak")}>🔥{h.streak}</span>
            <Dots h={h} />
          </li>
        ))}
        {!st.habits.length && <li className="muted text-sm">{t("life.noHabits")}</li>}
      </ul>
      <CalendarCard />
      <p className="muted text-xs">{t("life.todayLine", { min: st.focus.today, n: st.reminders.filter((r) => !r.fired).length })}</p>
    </div>
  );
}

function Capture({ st, act, planAct }: { st: LifeState; act: Act; planAct: PlanAct }) {
  const { t } = useT();
  const [task, setTask] = useState(""), [min, setMin] = useState("30"), [rank, setRank] = useState("2"), [due, setDue] = useState("");
  const [ok, setOk] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;
    if (await planAct({ task, min: Number(min), rank: Number(rank), ...(due && { due }) })) { setTask(""); setDue(""); setOk(true); }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="card space-y-2" aria-label={t("life.task")}>
        <input className="field w-full" value={task} onChange={(e) => { setTask(e.target.value); setOk(false); }} placeholder={t("life.taskPh")} aria-label={t("life.task")} maxLength={200} required />
        <div className="flex flex-wrap gap-2">
          <input className="field w-20" type="number" min={10} max={240} step={5} value={min} onChange={(e) => setMin(e.target.value)} aria-label={t("life.estimate")} />
          <select className="field" value={rank} onChange={(e) => setRank(e.target.value)} aria-label={t("life.priority")}>
            <option value="1">{t("life.prio1")}</option><option value="2">{t("life.prio2")}</option><option value="3">{t("life.prio3")}</option>
          </select>
          <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t("life.due")} />
          <button className="btn ml-auto" disabled={!task.trim()}>{t("common.add")}</button>
        </div>
        {ok && <p className="muted text-xs" role="status">{t("life.taskAdded")}</p>}
      </form>
      <Reminders st={st} act={act} />
    </div>
  );
}

function Review({ st, act, review }: { st: LifeState; act: Act; review: { text: string } | null }) {
  const { t } = useT();
  const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Tallinn" });
  return (
    <div className="space-y-3">
      <WeekCard />
      <section className="card space-y-1"><b>{t("life.reviewDay")}</b><p className="text-sm">{review?.text ?? <span className="muted">{t("life.notAccepted")}</span>}</p></section>
      <ul className="space-y-2">
        {st.review.unacked.map((r) => (
          <li key={r.id} className="card flex items-center gap-2 text-sm">
            <span className="flex-1">{r.text}<span className="muted block text-xs">{when(r.at)}{r.missed ? ` · ${t("life.missed")}` : ""}</span></span>
            <button className="chip" onClick={() => act({ action: "ack", id: r.id })} aria-label={t("life.ackAria", { text: r.text })}>{t("life.ack")}</button>
          </li>
        ))}
        {st.review.overdue.map((r) => <li key={r.id} className="card text-sm">{r.text}<span className="muted block text-xs">{when(r.at)} · {t("life.overdue")}</span></li>)}
        {!st.review.unacked.length && !st.review.overdue.length && <li className="muted text-sm">{t("life.nothingToAck")}</li>}
      </ul>
      <section className="card space-y-1 text-sm">
        <b>{t("life.worked")}</b>
        {st.work.length ? st.work.map((w) => <div key={w.task} className="flex justify-between"><span>{w.task}</span><span className="muted">{t("life.min", { n: w.min })}</span></div>) : <p className="muted">{t("life.noWork")}</p>}
      </section>
    </div>
  );
}

function Habits({ st, act }: { st: LifeState; act: Act }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !days.length) return;
    if (await act({ action: "addHabit", name, emoji: emoji || undefined, days })) { setName(""); setEmoji(""); setDays(ALL_DAYS); }
  };
  const remove = (h: HabitView) => { if (confirm(t("life.deleteHabit", { name: h.name }))) void act({ action: "removeHabit", id: h.id }); };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="card space-y-2">
        <div className="flex gap-2">
          <input className="field w-14 text-center" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🙂" aria-label={t("life.emoji")} maxLength={8} />
          <input className="field flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("life.habitPh")} aria-label={t("life.habitName")} maxLength={MAX_NAME} required />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={t("life.days")}>
          {DAY_LETTERS.map((l, d) => (
            <button key={d} type="button" className="chip" aria-pressed={days.includes(d)} aria-label={DAY_NAMES[d]}
              onClick={() => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort())}>{l}</button>
          ))}
          <button className="btn ml-auto" disabled={!name.trim() || !days.length || st.habits.length >= 30}>{t("common.add")}</button>
        </div>
        {st.habits.length >= 30 && <p className="muted text-xs">{t("life.max")}</p>}
      </form>
      <ul className="space-y-2">
        {st.habits.map((h) => (
          <li key={h.id} className="card space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1">
                {h.emoji} {h.name}
                <span className="muted block text-xs">{h.days.length === 7 ? t("life.everyDay") : h.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ")} · 🔥{h.streak}
                  {h.window && h.nudge && t("habit.nudgeAt", { t: hhmm(nudgeMinute(h, st.today)!) })}</span>
                <span className="muted block text-xs">{[h.target && t("habit.week", { n: h.weekDone ?? 0, target: h.target }), h.unit && t("habit.qtyToday", { n: h.amountToday ?? 0, goal: h.goal ?? 0, unit: h.unit }),
                  pausedTill(h, st.today) ? t("habit.paused", { d: pausedTill(h, st.today)! }) : h.off && t("habit.offToday"), h.trend && t(`habit.trend.${h.trend}`)].filter(Boolean).join(" · ")}</span>
              </span>
              <button className="chip" onClick={() => remove(h)} aria-label={t("life.deleteAria", { name: h.name })}>{t("rules.delete")}</button>
            </div>
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
    <form className="flex gap-1.5 text-xs" onSubmit={(e) => { e.preventDefault(); void act({ action: "nudge", id: h.id, when, channel }); }}>
      <input className="field flex-1" value={when} onChange={(e) => setWhen(e.target.value)} maxLength={60}
        placeholder={t("habit.when")} aria-label={t("habit.whenAria", { name: h.name })} />
      <select className="field" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t("habit.howAria", { name: h.name })}>
        <option value="off">{t("habit.off")}</option><option value="toast">{t("habit.toast")}</option><option value="push">{t("habit.push")}</option>
      </select>
      <button className="chip">{t("habit.save")}</button>
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
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void act({ action: "habitPlan", id: h.id, target: target ? Number(target) : null, ...(unit.trim() && goal ? { unit, goal: Number(goal) } : h.unit ? { unit: null } : {}) });
  };
  return (
    <details className="text-xs">
      <summary className="muted cursor-pointer">{t("habit.more")}</summary>
      <form className="mt-1 flex flex-wrap gap-1.5" onSubmit={save}>
        <input className="field w-20" type="number" min={1} max={7} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t("habit.target")} aria-label={t("habit.targetAria", { name: h.name })} />
        <input className="field w-28" value={unit} maxLength={MAX_UNIT} onChange={(e) => setUnit(e.target.value)} placeholder={t("habit.unit")} aria-label={t("habit.unit")} />
        <input className="field w-20" type="number" min={0} step="any" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("habit.goal")} aria-label={t("habit.goal")} />
        <button className="chip">{t("habit.save")}</button>
      </form>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button className="chip" aria-pressed={resting} onClick={() => act({ action: "habitPlan", id: h.id, rest: today })}>{t(resting ? "habit.restUndo" : "habit.restToday")}</button>
        {paused ? <button className="chip" onClick={() => act({ action: "habitPlan", id: h.id, pause: null })}>{t("habit.resume")}</button> : <>
          <input className="field" type="date" value={pause.from} onChange={(e) => setPause({ ...pause, from: e.target.value })} aria-label={t("habit.pauseFrom")} />
          <input className="field" type="date" value={pause.to} onChange={(e) => setPause({ ...pause, to: e.target.value })} aria-label={t("habit.pauseTo")} />
          <button className="chip" onClick={() => act({ action: "habitPlan", id: h.id, pause })}>{t("habit.pause")}</button>
        </>}
      </div>
    </details>
  );
}

/** A quantity habit's amount today (done at the goal; partial amounts are kept, not judged). */
function Amount({ h, act }: { h: HabitView; act: Act }) {
  const { t } = useT();
  const [n, setN] = useState(h.amountToday ? String(h.amountToday) : "");
  return (
    <form className="flex items-center gap-1 text-xs" onSubmit={(e) => { e.preventDefault(); void act({ action: "check", id: h.id, amount: Number(n) || 0 }); }}>
      <input className="field w-16" type="number" min={0} step="any" value={n} onChange={(e) => setN(e.target.value)} aria-label={t("habit.amountAria", { unit: h.unit ?? "", name: h.name })} />
      <span className="muted">/{h.goal} {h.unit}</span>
      <button className="chip">{t("habit.log")}</button>
    </form>
  );
}

/** LIF13: why the block is here, how long and whose estimate, its deadline and where it came from. */
function Why({ b }: { b: Block }) {
  const { t } = useT();
  if (!b.why || b.source.kind === "break" || b.source.kind === "personal") return null;
  const w = b.why;
  return <span className="muted block text-xs">{[t(`life.r.${w.r}`), `${b.end - b.start} min (${t(`life.est.${w.est}`)})`, w.due && t("life.dueOn", { d: w.due }), b.source.label].filter(Boolean).join(" · ")}</span>;
}

/** "Not today": out of plans until tomorrow (or next week); the same task isn't suggested again before then. */
function Defer({ id, title, planAct }: { id: string; title: string; planAct: PlanAct }) {
  const { t } = useT();
  return (
    <span className="flex shrink-0 gap-1">
      <button className="chip !py-0 text-xs" aria-label={t("life.deferAria", { title })} onClick={() => planAct({ defer: id, until: "tomorrow" })}>{t("life.defer")}</button>
      <button className="chip !py-0 text-xs" aria-label={t("life.deferWeekAria", { title })} onClick={() => planAct({ defer: id, until: "week" })}>{t("life.deferWeek")}</button>
    </span>
  );
}

/** LIF08: the last 7 days from local data (never the journal). Gaps are named, not filled in. */
function WeekCard() {
  const { t } = useT();
  const [r, setR] = useState<WeekReview | null>(null), [err, setErr] = useState("");
  const load = async () => {
    try { const res = await fetch("/api/life?week=1"); const j = await res.json(); if (!res.ok) throw new Error(j.error || res.status); setR(j); setErr(""); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  if (!r) return err ? <StateNote state="failed" what={err} action={{ label: t("state.retry"), run: () => void load() }} /> : null;
  const o = r.outcomes, a = r.adjust;
  return (
    <section className="card space-y-1 text-sm" aria-label={t("life.wk.title", { from: r.from, to: r.to })}>
      <b>{t("life.wk.title", { from: r.from, to: r.to })}</b>
      <p>{[r.accuracy && t("life.wk.tasks", { done: o.tasksDone, planned: o.tasksPlanned }), t("life.wk.focus", { min: o.focusMin }), o.habitsDue > 0 && t("life.wk.habits", { done: o.habitsDone, due: o.habitsDue })].filter(Boolean).join(" · ")}</p>
      {o.schoolDone.length > 0 && <p>{t("life.wk.school", { list: o.schoolDone.join(", ") })}</p>}
      {r.accuracy && <p><span className="muted">{t("life.wk.accuracy")}:</span> {t("life.wk.acc", { pct: r.accuracy.pct, done: r.accuracy.doneMin, planned: r.accuracy.plannedMin, days: r.accuracy.days })}</p>}
      <div><span className="muted">{t("life.wk.friction")}:</span> {r.friction.length ? <ul className="list-disc pl-4">{r.friction.map((f) => <li key={f.title}>{t("life.wk.fr", { title: f.title, d: f.deferred, m: f.missed })}</li>)}</ul> : t("life.wk.noFriction")}</div>
      <p><span className="muted">{t("life.wk.adjust")}:</span> {a ? t(`life.wk.adj.${a.suggest}`, { name: a.name, pct: Math.round(a.rate * 100) }) : t("life.wk.noAdjust")}</p>
      {r.missing.length > 0 && <p className="muted text-xs">{t("life.wk.missing", { list: r.missing.map((m) => t(`life.wk.m.${m}`)).join(", ") })}</p>}
      <p className="muted text-xs">{t("life.wk.private")}</p>
    </section>
  );
}

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

function Focus({ st, reload }: { st: LifeState; reload: () => Promise<void> }) {
  const { t } = useT();
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const len = phaseLen;
  const running = timer.endAt > 0;
  const left = running ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)) : timer.left;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const f = (logged?: boolean) => { if (logged) void reloadRef.current(); rerender(); }; // logged: a session's minutes were saved
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
  return (
    <div className="space-y-3">
      <div className="card space-y-3 text-center">
        <div className="flex justify-center gap-1.5" role="group" aria-label={t("life.timerLen")}>
          {([25, 50] as const).map((p) => (
            <button key={p} className="chip" aria-pressed={timer.plan === p} onClick={() => reset(p)}>{p}/{p / 5}</button>
          ))}
        </div>
        <input className="field w-full text-center" value={timer.task ?? ""} maxLength={120} aria-label={t("life.focusTask")} placeholder={t("life.focusTaskPh")}
          onChange={(e) => { if (e.target.value) timer.task = e.target.value; else delete timer.task; rerender(); }} onBlur={saveTimer} />
        <div className="muted text-xs uppercase tracking-widest">{t(timer.phase === "focus" ? "life.tab.Focus" : "life.break")}</div>
        <div className="brand font-mono text-5xl" role="timer" aria-live="off">{mmss}</div>
        <div className="flex justify-center gap-2">
          {running ? <button className="btn" onClick={pause}>{t("rules.pause")}</button> : <button className="btn" onClick={start}>{t("life.start")}</button>}
          {timer.phase === "focus" && workedMinutes(timer, Date.now()) >= 1 && <button className="chip" onClick={stop}>{t("life.stop")}</button>}
          <button className="chip" onClick={() => reset()}>{t("life.reset")}</button>
        </div>
      </div>
      <p className="text-sm">{t("life.focusToday")} <b>{st.focus.today} min</b> <span className="muted">{t("life.focusWeek", { min: st.focus.week })}</span></p>
    </div>
  );
}

/* ---------------- Reminders ---------------- */
function Reminders({ st, act }: { st: LifeState; act: Act }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [repeat, setRepeat] = useState("");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = new Date(at); // datetime-local is this device's local time; the server keeps its Europe/Tallinn wall clock
    if (!text.trim() || isNaN(d.getTime())) return;
    if (await act({ action: "addReminder", text, at: d.toISOString(), ...(repeat ? { repeat } : {}) })) { setText(""); setAt(""); setRepeat(""); }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="card space-y-2">
        <input className="field w-full" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("life.remindPh")} aria-label={t("life.remindText")} maxLength={MAX_REMINDER} required />
        <div className="flex gap-2">
          <input className="field flex-1" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t("life.remindAt")} required />
          <select className="field" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label={t("life.repeat")}>
            <option value="">{t("life.once")}</option><option value="daily">{t("life.everyDay")}</option><option value="weekdays">{t("life.weekdays")}</option><option value="weekly">{t("life.everyWeek")}</option>
          </select>
          <button className="btn" disabled={!text.trim() || !at}>{t("common.add")}</button>
        </div>
      </form>
      <p className="muted text-xs">{t("life.tz")}</p>
      {perm === "default" && (
        <button className="chip" onClick={async () => setPerm(await Notification.requestPermission())}>{t("life.notify")}</button>
      )}
      <ul className="space-y-2">
        {st.reminders.map((r) => (
          <li key={r.id} className="card flex items-center gap-2 text-sm">
            <span className="flex-1">
              {r.text}
              <span className="muted block text-xs">{new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Tallinn" })}{r.fired ? t("life.done") : ""}{isRepeat(r.repeat) ? ` · ↻ ${REPEAT_LABEL[r.repeat]}` : ""}</span>
            </span>
            <button className="chip" onClick={() => act({ action: "removeReminder", id: r.id })} aria-label={t("life.deleteReminder", { text: r.text })}>{t("rules.delete")}</button>
          </li>
        ))}
        {!st.reminders.length && <li className="muted text-sm">{t("life.noReminders")}</li>}
      </ul>
    </div>
  );
}

/* ---------------- Journal ---------------- */
function Journal({ st, act }: { st: LifeState; act: Act }) {
  const { t } = useT();
  const today = st.journal[0];
  const [text, setText] = useState(today.text);
  const [saved, setSaved] = useState<string | null>(null);
  const latest = useRef({ text, base: today.text, date: today.date });
  latest.current = { text, base: today.text, date: today.date };
  // Closing the drawer while typing may unmount without a blur: save what's there on the way out.
  useEffect(() => () => { const l = latest.current; if (l.text !== l.base) post({ action: "journal", text: l.text, date: l.date }).catch(() => {}); }, []);
  const save = async () => { // true when today's text is saved (or unchanged)
    if (text === today.text) return true;
    if (await act({ action: "journal", text, date: today.date })) { setSaved(t("life.saved")); return true; }
    return false;
  };
  return (
    <div className="space-y-3">
      <label className="card block space-y-2">
        <span className="flex justify-between text-sm"><b>{t("life.tab.Today")}</b><span className="muted text-xs">{saved ?? `${text.length}/${MAX_JOURNAL}`}</span></span>
        <textarea className="field min-h-32 w-full" value={text} onChange={(e) => { setText(e.target.value); setSaved(null); }} onBlur={save}
          maxLength={MAX_JOURNAL} placeholder={t("life.journalPh")} />
      </label>
      <ul className="space-y-2">
        {st.journal.slice(1).filter((j) => j.text).map((j) => (
          <li key={j.date} className="card text-sm">
            <div className="muted text-xs">{longDate(j.date)}</div>
            <p className="whitespace-pre-wrap">{j.text}</p>
          </li>
        ))}
      </ul>
      <Reflect fallback={t("life.journalPrivate")} />
    </div>
  );
}

/** "Reflect on my week": only when ORBIT_LOCAL_PRIVATE=1, only on click, read by the local model on this PC (never Claude). */
function Reflect({ fallback }: { fallback: string }) {
  const { t } = useT();
  const [on, setOn] = useState(false);
  const [r, setR] = useState<{ text?: string; label?: string; model?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/local-brain", { cache: "no-store" }).then((x) => x.json()).then((j) => setOn(j?.brain?.private === true), () => {}); }, []);
  if (!on) return <p className="muted text-xs">{fallback}</p>;
  const go = async () => {
    setBusy(true);
    setR(await fetch("/api/life/reflect", { method: "POST" }).then((x) => x.json(), () => ({ error: "Couldn't reach ORBIT" })));
    setBusy(false);
  };
  return (
    <div className="card space-y-2 text-sm">
      <button className="chip" disabled={busy} onClick={() => void go()}>{busy ? t("life.localReflecting") : t("life.localReflect")}</button>
      <p className="muted text-xs">{t("life.localReflectNote")}</p>
      {r?.error && <p className="text-xs" style={{ color: "#fbbf24" }}>{r.error}</p>}
      {r?.text && <><p className="whitespace-pre-wrap">{r.text}</p><p className="muted text-xs">{r.label} ({r.model})</p></>}
    </div>
  );
}
