// LIFE workspace: pure date/streak/validation logic (shared by server, UI and tests; no node or next imports).
// Days are local "YYYY-MM-DD" keys; day steps go through the Date constructor so DST never skips or repeats a day.

import type { FocusTimer } from "./focus-timer-pure.ts";
import { reviewState } from "./reminders-pure.ts";

export type Habit = {
  id: string; name: string; emoji: string; days: number[]; created: string; done: string[];
  // Habit engine (habit-nudge-pure): window = minutes of the day, nudge absent = off, at = check-in minute per day, nudged = last nudge day.
  window?: { from: number; to: number }; nudge?: "toast" | "push"; at?: Record<string, number>; nudged?: string; ignored?: number;
  // LIF04: target = check-ins a week (any of its days); unit + goal = a quantity habit (amount per day in qty, done once it reaches goal);
  // pauses = date ranges it is off (holiday, illness); rest = single rest days he took. Off days never break a streak or count as missed.
  target?: number; unit?: string; goal?: number; qty?: Record<string, number>; pauses?: { from: string; to: string }[]; rest?: string[];
};
export const REPEATS = ["daily", "weekdays", "weekly"] as const;
export type Repeat = (typeof REPEATS)[number];
/** repeat absent = one-off (old data has none). A recurring reminder is one record whose `at` moves forward and never gets `fired`. */
// time: "HH:MM" Europe/Tallinn wall clock of a repeating one; last: the last notice shown (missed = ORBIT was off); ack: he saw it
export type Reminder = { id: string; text: string; at: string; fired?: string; repeat?: Repeat; time?: string; last?: { at: string; missed: boolean }; ack?: string };
/** work: focus minutes actually worked per task and day (LIF05); timer: the live focus timer, shared across his devices. */
export type WorkLog = { day: string; task: string; min: number };
export type LifeStore = { habits: Habit[]; reminders: Reminder[]; focus: Record<string, number>; journal: Record<string, string>; work?: WorkLog[]; timer?: FocusTimer };
export type DayDot = { date: string; scheduled: boolean; done: boolean };
/** weekDone: check-ins this week (Mon–today); off: paused or a rest day today; trend: neutral 4-week direction (LIF04). Optional: older callers build views without them. */
export type HabitView = Habit & { streak: number; week: DayDot[]; doneToday: boolean; scheduledToday: boolean; weekDone?: number; off?: boolean; trend?: Trend; amountToday?: number };
export type LifeState = {
  today: string; habits: HabitView[]; reminders: Reminder[];
  focus: { today: number; week: number }; journal: { date: string; text: string }[];
  work: WorkLog[]; timer: FocusTimer | null; review: ReturnType<typeof reviewState>;
};

export const MAX_HABITS = 30, MAX_OPEN_REMINDERS = 100, MAX_NAME = 60, MAX_REMINDER = 140, MAX_JOURNAL = 2000, MAX_FOCUS_MIN = 180;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_MS = 86400_000;

export const emptyStore = (): LifeStore => ({ habits: [], reminders: [], focus: {}, journal: {} });

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isDateKey = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(fromKey(s)) === s;
const fromKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (k: string, n: number) => { const d = fromKey(k); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12)); };
export const weekday = (k: string) => fromKey(k).getDay();
/** Monday of the week containing k. */
export const weekStart = (k: string) => addDays(k, -((weekday(k) + 6) % 7));

type Sched = Pick<Habit, "days" | "pauses" | "rest">;
/** Paused or a rest day: not expected, not missed. */
export const isOff = (h: Pick<Habit, "pauses" | "rest">, k: string) => !!h.rest?.includes(k) || !!h.pauses?.some((p) => k >= p.from && k <= p.to);
export const scheduledOn = (h: Sched, k: string) => h.days.includes(weekday(k)) && !isOff(h, k);
/** Check-ins in the Mon–Sun week of k, up to k. */
export const weekCount = (h: Pick<Habit, "done">, k: string) => { const ws = weekStart(k); return h.done.filter((d) => d >= ws && d <= k).length; };

/** Consecutive scheduled days done, ending today. Today not done yet doesn't break it; unscheduled and off days are skipped.
 *  A weekly-target habit counts weeks that met the target (this week only once met; a fully paused week is skipped). */
export function streak(h: Sched & Pick<Habit, "done" | "created" | "target">, today: string): number {
  if (!h.days.length) return 0;
  const done = new Set(h.done);
  let n = 0;
  if (h.target) {
    for (let ws = weekStart(today), i = 0; i < 150 && addDays(ws, 6) >= h.created; ws = addDays(ws, -7), i++) {
      const end = ws === weekStart(today) ? today : addDays(ws, 6);
      if ([0, 1, 2, 3, 4, 5, 6].every((d) => isOff(h, addDays(ws, d)))) continue;
      if (weekCount(h, end) >= h.target) n++;
      else if (ws !== weekStart(today)) break;
    }
    return n;
  }
  for (let k = today, i = 0; i < 1000 && k >= h.created; k = addDays(k, -1), i++) {
    if (!scheduledOn(h, k)) continue;
    if (done.has(k)) n++;
    else if (k !== today) break;
  }
  return n;
}

export const last7 = (h: Sched & Pick<Habit, "done">, today: string): DayDot[] =>
  [6, 5, 4, 3, 2, 1, 0].map((i) => { const date = addDays(today, -i); return { date, scheduled: scheduledOn(h, date), done: h.done.includes(date) }; });

/** Expected today: a weekly-target habit until this week's target is met, else its scheduled days. Never on an off day. */
export const dueToday = (h: Sched & Pick<Habit, "done" | "target">, today: string) =>
  !isOff(h, today) && (h.target ? h.days.includes(weekday(today)) && weekCount(h, today) - (h.done.includes(today) ? 1 : 0) < h.target : scheduledOn(h, today));

/** Share of what was expected that got done, per week (oldest first), over the last `weeks` full weeks. Off days drop out. null = nothing expected. */
export function weekRates(h: Sched & Pick<Habit, "done" | "created" | "target">, today: string, weeks = 4): (number | null)[] {
  const out: (number | null)[] = [];
  for (let w = weeks; w >= 1; w--) {
    const ws = addDays(weekStart(today), -7 * w), keys = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(ws, d)).filter((k) => k >= h.created);
    const exp = keys.filter((k) => scheduledOn(h, k)), did = keys.filter((k) => h.done.includes(k)).length;
    const want = h.target ? Math.min(h.target, exp.length) : exp.length;
    out.push(want ? Math.min(1, (h.target ? did : exp.filter((k) => h.done.includes(k)).length) / want) : null);
  }
  return out;
}
export type Trend = "new" | "up" | "steady" | "down";
/** Neutral direction: last two weeks vs the two before (needs both halves). Wording in the UI never scolds. */
export function trend(rates: (number | null)[]): Trend {
  const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const half = rates.length >> 1, a = avg(rates.slice(0, half)), b = avg(rates.slice(half));
  if (a === null || b === null) return "new";
  return b - a > 0.15 ? "up" : a - b > 0.15 ? "down" : "steady";
}

export const MAX_UNIT = 20, MAX_GOAL = 10_000, MAX_PAUSE_DAYS = 120, MAX_REST = 60;
export type HabitPlan = { target?: number | null; unit?: string | null; goal?: number | null; pause?: { from: string; to: string } | null; rest?: string };
/** Validated LIF04 options → a patch to apply, or why not. null fields clear the option. */
export function habitPlanPatch(b: Record<string, unknown>): HabitPlan | string {
  const out: HabitPlan = {};
  if (b.target !== undefined) {
    if (b.target !== null && !(Number.isInteger(b.target) && (b.target as number) >= 1 && (b.target as number) <= 7)) return "Weekly target must be 1–7";
    out.target = b.target as number | null;
  }
  if (b.unit !== undefined || b.goal !== undefined) {
    if (b.unit === null || b.goal === null) { out.unit = null; out.goal = null; }
    else {
      const u = typeof b.unit === "string" ? b.unit.replace(/\s+/g, " ").trim() : "", g = Number(b.goal);
      if (!u || u.length > MAX_UNIT || /[<>]/.test(u)) return `Unit must be 1–${MAX_UNIT} characters`;
      if (!Number.isFinite(g) || g <= 0 || g > MAX_GOAL) return `Daily goal must be more than 0 and at most ${MAX_GOAL}`;
      out.unit = u; out.goal = Math.round(g * 100) / 100;
    }
  }
  if (b.pause !== undefined) {
    const p = b.pause as { from?: unknown; to?: unknown } | null;
    if (p !== null && !(isDateKey(p?.from) && isDateKey(p?.to) && p.from <= p.to && addDays(p.from, MAX_PAUSE_DAYS) >= p.to)) return `A pause needs from ≤ to, at most ${MAX_PAUSE_DAYS} days`;
    out.pause = p as HabitPlan["pause"];
  }
  if (b.rest !== undefined) { if (!isDateKey(b.rest)) return "Rest day must be a date"; out.rest = b.rest; }
  return out;
}
/** Applies a patch (mutates). A pause replaces any pause that overlaps it; null ends pauses from today on; rest toggles that day. */
export function applyHabitPlan(h: Habit, p: HabitPlan, today: string): void {
  if (p.target !== undefined) { if (p.target === null) delete h.target; else h.target = p.target; }
  if (p.unit !== undefined) { if (p.unit === null) { delete h.unit; delete h.goal; } else { h.unit = p.unit; h.goal = p.goal!; } }
  if (p.pause !== undefined) {
    const keep = (h.pauses ?? []).filter((x) => x.to >= addDays(today, -90)); // old pauses only matter for recent streaks
    if (p.pause === null) h.pauses = keep.map((x) => (x.to >= today ? { ...x, to: addDays(today, -1) } : x)).filter((x) => x.from <= x.to);
    else h.pauses = [...keep.filter((x) => x.to < p.pause!.from || x.from > p.pause!.to), p.pause].sort((a, b) => a.from.localeCompare(b.from)).slice(-10);
    if (!h.pauses.length) delete h.pauses;
  }
  if (p.rest !== undefined) {
    const set = new Set(h.rest ?? []);
    if (set.has(p.rest)) set.delete(p.rest); else set.add(p.rest);
    h.rest = [...set].sort().slice(-MAX_REST);
    if (!h.rest.length) delete h.rest;
  }
}
/** A quantity check-in: the day's amount (0 clears it) and whether it reached the goal. */
export function recordAmount(h: Habit, day: string, amount: number): boolean {
  const q = { ...h.qty };
  if (amount > 0) q[day] = Math.min(MAX_GOAL * 10, Math.round(amount * 100) / 100); else delete q[day];
  h.qty = Object.fromEntries(Object.entries(q).sort(([a], [b]) => a.localeCompare(b)).slice(-400));
  return amount > 0 && amount >= (h.goal ?? 1);
}

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= MAX_NAME ? s : null;
}
/** A short emoji/symbol (≤ 8 UTF-16 units covers flags and ZWJ sequences), or "" when missing. null = invalid. */
export function cleanEmoji(v: unknown): string | null {
  if (v == null || v === "") return "";
  return typeof v === "string" && v.trim().length <= 8 && !/[\w<>]/.test(v) ? v.trim() : null;
}
export function cleanDays(v: unknown): number[] | null {
  if (v == null) return [...ALL_DAYS];
  if (!Array.isArray(v) || !v.length || v.length > 7 || !v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  return [...new Set(v as number[])].sort();
}

/** Habit by id, case-insensitive exact name, or unique name prefix. */
export function matchHabit<H extends Pick<Habit, "id" | "name">>(habits: H[], q: string): H | null {
  const t = q.trim().toLocaleLowerCase();
  if (!t) return null;
  const exact = habits.find((h) => h.id === q.trim() || h.name.toLocaleLowerCase() === t);
  if (exact) return exact;
  const pre = habits.filter((h) => h.name.toLocaleLowerCase().startsWith(t));
  return pre.length === 1 ? pre[0] : null;
}

/** Error text, or null when the reminder time is OK (not over 1 min past, not over 1 year ahead). */
export function reminderTimeError(iso: unknown, now: number): string | null {
  const t = typeof iso === "string" && iso.length <= 40 ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "Invalid date/time";
  if (t < now - 60_000) return "That time is in the past";
  if (t > now + 366 * DAY_MS) return "Reminders can be at most a year ahead";
  return null;
}
export const isRepeat = (v: unknown): v is Repeat => (REPEATS as readonly unknown[]).includes(v);
export const REPEAT_LABEL: Record<Repeat, string> = { daily: "every day", weekdays: "weekdays", weekly: "every week" };

export const dueReminders = (rs: Reminder[], now: number) => rs.filter((r) => !r.fired && Date.parse(r.at) <= now);
/** Upcoming plus anything from the last day, soonest first. */
export const visibleReminders = (rs: Reminder[], now: number) =>
  rs.filter((r) => Date.parse(r.at) > now - DAY_MS).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
/** Drops reminders more than a day past, once fired (unfired ones stay until they fire). */
export const pruneReminders = (rs: Reminder[], now: number) => rs.filter((r) => !(r.fired && Date.parse(r.at) < now - DAY_MS));

export function view(s: LifeStore, now: number): LifeState {
  const today = dateKey(new Date(now));
  const ws = weekStart(today);
  return {
    today,
    habits: s.habits.map((h) => ({ ...h, streak: streak(h, today), week: last7(h, today), doneToday: h.done.includes(today), scheduledToday: dueToday(h, today),
      weekDone: weekCount(h, today), off: isOff(h, today), trend: trend(weekRates(h, today)), ...(h.qty?.[today] !== undefined && { amountToday: h.qty[today] }) })),
    reminders: visibleReminders(s.reminders, now),
    focus: { today: s.focus[today] ?? 0, week: Object.entries(s.focus).filter(([k]) => k >= ws && k <= today).reduce((a, [, m]) => a + m, 0) },
    work: (s.work ?? []).filter((w) => w.day === today), timer: s.timer ?? null, review: reviewState(s.reminders, now),
    journal: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, -i)).map((date) => ({ date, text: s.journal[date] ?? "" })),
  };
}

/** ≤600 chars of plain text for CORE's context. */
export function summaryText(st: LifeState, now: number): string {
  const todays = st.habits.filter((h) => h.scheduledToday);
  const fmt = (h: HabitView) => `${h.name}${h.streak ? ` (streak ${h.streak})` : ""}`;
  const done = todays.filter((h) => h.doneToday), pending = todays.filter((h) => !h.doneToday);
  const next = st.reminders.filter((r) => !r.fired && Date.parse(r.at) > now).slice(0, 3)
    .map((r) => `${new Date(r.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} ${r.text}`);
  const lines = [
    `LIFE ${st.today}: habits ${done.length}/${todays.length} done today.`,
    done.length ? `Done: ${done.map(fmt).join(", ")}.` : "",
    pending.length ? `Pending: ${pending.map(fmt).join(", ")}.` : "",
    next.length ? `Next reminders: ${next.join("; ")}.` : "No upcoming reminders.",
    `Focus today: ${st.focus.today} min (week ${st.focus.week} min).`,
  ];
  const out = lines.filter(Boolean).join(" ");
  return out.length > 600 ? out.slice(0, 599) + "…" : out;
}
