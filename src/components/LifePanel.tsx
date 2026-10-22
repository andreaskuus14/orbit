"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ALL_DAYS, MAX_JOURNAL, MAX_NAME, MAX_REMINDER, REPEAT_LABEL, isRepeat, type HabitView, type LifeState } from "@/lib/life-pure";
import type { LifeView } from "@/lib/nav-pure";
import { VOICE_ASK } from "./voice/bus";
import CalendarCard from "./CalendarCard";

// LIFE workspace drawer: today's habits, habit list, focus timer, reminders, journal. All data via /api/life.

async function post<T = Record<string, unknown>>(body: object): Promise<T> {
  const res = await fetch("/api/life", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TABS = ["Today", "Habits", "Focus", "Reminders", "Journal"] as const;
type Tab = (typeof TABS)[number];
const TAB_OF: Record<LifeView, Tab> = { today: "Today", habits: "Habits", focus: "Focus", reminders: "Reminders", journal: "Journal" };
const longDate = (k: string) => new Date(`${k}T12:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

/** open: a voice/palette request (new object per command), so it applies again even while the drawer is open. */
export default function LifePanel({ open }: { open?: { tab: LifeView; start?: true } | null }) {
  const [tab, setTab] = useState<Tab>("Today");
  useEffect(() => { if (!open) return; setTab(TAB_OF[open.tab]); if (open.start) startTimer(); }, [open]);
  const [st, setSt] = useState<LifeState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/life");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setSt(json as LifeState); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (body: object) => {
    try { const r = await post(body); setErr(null); await load(); return r; } catch (e) { setErr((e as Error).message); return null; }
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Life sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {!st ? (!err && <p className="muted text-sm">Loading…</p>) : (
        <div role="tabpanel" aria-label={tab}>
          {tab === "Today" && <Today st={st} act={act} />}
          {tab === "Habits" && <Habits st={st} act={act} />}
          {tab === "Focus" && <Focus st={st} reload={load} />}
          {tab === "Reminders" && <Reminders st={st} act={act} />}
          {tab === "Journal" && <Journal st={st} act={act} />}
        </div>
      )}
    </div>
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

function Today({ st, act }: { st: LifeState; act: Act }) {
  const todays = st.habits.filter((h) => h.scheduledToday);
  const done = todays.filter((h) => h.doneToday).length;
  return (
    <div className="space-y-3">
      <div className="card flex items-baseline justify-between gap-2">
        <b>{longDate(st.today)}</b>
        <span className="muted text-sm">{todays.length ? `${done}/${todays.length} done` : "No habits today"}</span>
      </div>
      <ul className="space-y-2">
        {todays.map((h) => (
          <li key={h.id} className="card flex items-center gap-3 text-sm">
            <button className="chip" aria-pressed={h.doneToday} aria-label={`${h.name}: ${h.doneToday ? "done, mark not done" : "mark done"}`}
              onClick={() => act({ action: "check", id: h.id, done: !h.doneToday })}>{h.doneToday ? "✓" : "○"}</button>
            <span className="flex-1">{h.emoji} {h.name}</span>
            <span className="muted text-xs" title="Current streak">🔥{h.streak}</span>
            <Dots h={h} />
          </li>
        ))}
        {!st.habits.length && <li className="muted text-sm">No habits yet. Add one under Habits.</li>}
      </ul>
      <CalendarCard />
      <p className="muted text-xs">Focus today: {st.focus.today} min · {st.reminders.filter((r) => !r.fired).length} upcoming reminders</p>
    </div>
  );
}

function Habits({ st, act }: { st: LifeState; act: Act }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !days.length) return;
    if (await act({ action: "addHabit", name, emoji: emoji || undefined, days })) { setName(""); setEmoji(""); setDays(ALL_DAYS); }
  };
  const remove = (h: HabitView) => { if (confirm(`Delete “${h.name}” and its history?`)) void act({ action: "removeHabit", id: h.id }); };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="card space-y-2">
        <div className="flex gap-2">
          <input className="field w-14 text-center" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🙂" aria-label="Emoji (optional)" maxLength={8} />
          <input className="field flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="New habit, e.g. Read 10 pages" aria-label="Habit name" maxLength={MAX_NAME} required />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Days">
          {DAY_LETTERS.map((l, d) => (
            <button key={d} type="button" className="chip" aria-pressed={days.includes(d)} aria-label={DAY_NAMES[d]}
              onClick={() => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort())}>{l}</button>
          ))}
          <button className="btn ml-auto" disabled={!name.trim() || !days.length || st.habits.length >= 30}>Add</button>
        </div>
        {st.habits.length >= 30 && <p className="muted text-xs">Maximum of 30 habits reached.</p>}
      </form>
      <ul className="space-y-2">
        {st.habits.map((h) => (
          <li key={h.id} className="card flex items-center gap-2 text-sm">
            <span className="flex-1">
              {h.emoji} {h.name}
              <span className="muted block text-xs">{h.days.length === 7 ? "Every day" : h.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ")} · 🔥{h.streak}</span>
            </span>
            <button className="chip" onClick={() => remove(h)} aria-label={`Delete ${h.name}`}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Focus timer ---------------- */
type Phase = "focus" | "break";
// Module scope so closing and reopening the drawer keeps a running timer.
const timer = { plan: 25 as 25 | 50, phase: "focus" as Phase, endAt: 0, left: 25 * 60 };
const phaseLen = (p: Phase) => (p === "focus" ? timer.plan : timer.plan / 5) * 60;
const timerListeners = new Set<(logged?: boolean) => void>();
let timerTick: ReturnType<typeof setInterval> | null = null;
// The tick lives at module scope too, so a session finishes (beep + logged minutes) even with the drawer or Focus tab closed.
// shortcut: a page reload still loses a running timer; persist endAt in localStorage if that matters.
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
      beep();
      if (timer.phase === "focus") post({ action: "focus", minutes: timer.plan }).then(() => timerListeners.forEach((f) => f(true)), () => {});
      timer.phase = timer.phase === "focus" ? "break" : "focus";
      timer.left = phaseLen(timer.phase);
      timer.endAt = timer.phase === "break" ? Date.now() + timer.left * 1000 : 0; // break starts on its own; next focus waits for Start
    }
    focusSignal();
    if (!timer.endAt && timerTick) { clearInterval(timerTick); timerTick = null; }
    timerListeners.forEach((f) => f());
  }, 500);
}

/** The Start button's logic; a running timer is left alone. */
function startTimer() {
  if (timer.endAt) return;
  timer.endAt = Date.now() + timer.left * 1000;
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

function Focus({ st, reload }: { st: LifeState; reload: () => Promise<void> }) {
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
  const pause = () => { timer.left = left; timer.endAt = 0; rerender(); };
  const reset = (plan = timer.plan) => { timer.plan = plan; timer.phase = "focus"; timer.endAt = 0; timer.left = len("focus"); rerender(); };
  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className="space-y-3">
      <div className="card space-y-3 text-center">
        <div className="flex justify-center gap-1.5" role="group" aria-label="Timer length">
          {([25, 50] as const).map((p) => (
            <button key={p} className="chip" aria-pressed={timer.plan === p} onClick={() => reset(p)}>{p}/{p / 5}</button>
          ))}
        </div>
        <div className="muted text-xs uppercase tracking-widest">{timer.phase === "focus" ? "Focus" : "Break"}</div>
        <div className="brand font-mono text-5xl" role="timer" aria-live="off">{mmss}</div>
        <div className="flex justify-center gap-2">
          {running ? <button className="btn" onClick={pause}>Pause</button> : <button className="btn" onClick={start}>Start</button>}
          <button className="chip" onClick={() => reset()}>Reset</button>
        </div>
      </div>
      <p className="text-sm">Focus today: <b>{st.focus.today} min</b> <span className="muted">· this week {st.focus.week} min</span></p>
    </div>
  );
}

/* ---------------- Reminders ---------------- */
function Reminders({ st, act }: { st: LifeState; act: Act }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [repeat, setRepeat] = useState("");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = new Date(at); // datetime-local is local time without zone
    if (!text.trim() || isNaN(d.getTime())) return;
    if (await act({ action: "addReminder", text, at: d.toISOString(), ...(repeat ? { repeat } : {}) })) { setText(""); setAt(""); setRepeat(""); }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="card space-y-2">
        <input className="field w-full" value={text} onChange={(e) => setText(e.target.value)} placeholder="Remind me to…" aria-label="Reminder text" maxLength={MAX_REMINDER} required />
        <div className="flex gap-2">
          <input className="field flex-1" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Reminder date and time" required />
          <select className="field" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="Repeat">
            <option value="">Once</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Every week</option>
          </select>
          <button className="btn" disabled={!text.trim() || !at}>Add</button>
        </div>
      </form>
      {perm === "default" && (
        <button className="chip" onClick={async () => setPerm(await Notification.requestPermission())}>Enable desktop notifications</button>
      )}
      <ul className="space-y-2">
        {st.reminders.map((r) => (
          <li key={r.id} className="card flex items-center gap-2 text-sm">
            <span className="flex-1">
              {r.text}
              <span className="muted block text-xs">{new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{r.fired ? " · done" : ""}{isRepeat(r.repeat) ? ` · ↻ ${REPEAT_LABEL[r.repeat]}` : ""}</span>
            </span>
            <button className="chip" onClick={() => act({ action: "removeReminder", id: r.id })} aria-label={`Delete reminder ${r.text}`}>Delete</button>
          </li>
        ))}
        {!st.reminders.length && <li className="muted text-sm">No upcoming reminders.</li>}
      </ul>
    </div>
  );
}

/* ---------------- Journal ---------------- */
function Journal({ st, act }: { st: LifeState; act: Act }) {
  const today = st.journal[0];
  const [text, setText] = useState(today.text);
  const [saved, setSaved] = useState<string | null>(null);
  const latest = useRef({ text, base: today.text, date: today.date });
  latest.current = { text, base: today.text, date: today.date };
  // Closing the drawer while typing may unmount without a blur: save what's there on the way out.
  useEffect(() => () => { const l = latest.current; if (l.text !== l.base) post({ action: "journal", text: l.text, date: l.date }).catch(() => {}); }, []);
  const save = async () => { // true when today's text is saved (or unchanged)
    if (text === today.text) return true;
    if (await act({ action: "journal", text, date: today.date })) { setSaved("Saved"); return true; }
    return false;
  };
  return (
    <div className="space-y-3">
      <label className="card block space-y-2">
        <span className="flex justify-between text-sm"><b>Today</b><span className="muted text-xs">{saved ?? `${text.length}/${MAX_JOURNAL}`}</span></span>
        <textarea className="field min-h-32 w-full" value={text} onChange={(e) => { setText(e.target.value); setSaved(null); }} onBlur={save}
          maxLength={MAX_JOURNAL} placeholder="How was today? (saves when you click away)" />
      </label>
      <ul className="space-y-2">
        {st.journal.slice(1).filter((j) => j.text).map((j) => (
          <li key={j.date} className="card text-sm">
            <div className="muted text-xs">{longDate(j.date)}</div>
            <p className="whitespace-pre-wrap">{j.text}</p>
          </li>
        ))}
      </ul>
      {st.journal.filter((j) => j.text.trim()).length >= 2 && (
        <button className="btn" onClick={async () => { if (!(await save())) return; dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: "Read my journal from the last 7 days and reflect: patterns, wins, and one suggestion for next week." } })); }}>Reflect with CORE</button>)}
    </div>
  );
}
