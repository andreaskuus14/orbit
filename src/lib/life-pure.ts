// LIFE workspace: pure date/streak/validation logic (shared by server, UI and tests; no node or next imports).
// Days are local "YYYY-MM-DD" keys; day steps go through the Date constructor so DST never skips or repeats a day.

export type Habit = { id: string; name: string; emoji: string; days: number[]; created: string; done: string[] };
export type Reminder = { id: string; text: string; at: string; fired?: string };
export type LifeStore = { habits: Habit[]; reminders: Reminder[]; focus: Record<string, number>; journal: Record<string, string> };
export type DayDot = { date: string; scheduled: boolean; done: boolean };
export type HabitView = Habit & { streak: number; week: DayDot[]; doneToday: boolean; scheduledToday: boolean };
export type LifeState = {
  today: string; habits: HabitView[]; reminders: Reminder[];
  focus: { today: number; week: number }; journal: { date: string; text: string }[];
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

/** Consecutive scheduled days done, ending today. Today not done yet doesn't break it; unscheduled days are skipped. */
export function streak(h: Pick<Habit, "days" | "done" | "created">, today: string): number {
  if (!h.days.length) return 0;
  const done = new Set(h.done);
  let n = 0;
  for (let k = today, i = 0; i < 1000 && k >= h.created; k = addDays(k, -1), i++) {
    if (!h.days.includes(weekday(k))) continue;
    if (done.has(k)) n++;
    else if (k !== today) break;
  }
  return n;
}

export const last7 = (h: Pick<Habit, "days" | "done">, today: string): DayDot[] =>
  [6, 5, 4, 3, 2, 1, 0].map((i) => { const date = addDays(today, -i); return { date, scheduled: h.days.includes(weekday(date)), done: h.done.includes(date) }; });

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
    habits: s.habits.map((h) => ({ ...h, streak: streak(h, today), week: last7(h, today), doneToday: h.done.includes(today), scheduledToday: h.days.includes(weekday(today)) })),
    reminders: visibleReminders(s.reminders, now),
    focus: { today: s.focus[today] ?? 0, week: Object.entries(s.focus).filter(([k]) => k >= ws && k <= today).reduce((a, [, m]) => a + m, 0) },
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Journal entries of the last `days` days (today included), newest first, as "YYYY-MM-DD (Weekday): text", whole entries up to `max` chars. */
export function journalText(journal: Record<string, string>, today: string, days: number, max = 8000): string {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(today, -i), text = journal[date]?.trim();
    if (!text) continue;
    const line = `${date} (${WEEKDAYS[weekday(date)]}): ${text}`;
    if (len + line.length > max) { out.push("(older entries omitted)"); break; }
    out.push(line);
    len += line.length + 1;
  }
  return out.join("\n");
}
