// Habit engine (roadmap 3): when to nudge a LIFE habit. Pure; tested in tests/habit-nudge.test.ts. No model calls: LIFE data stays local.
// Timing: median of his own check-in minutes inside the habit's window (same weekday when there are 2+, else all), nudge 10 min before.
// Back-off: after 2 ignored nudges in a row, one try a week until he checks it in again. Quiet hours/focus/Stop-all are the caller's ctx.
import { addDays, weekStart, weekday, type Habit } from "./life-pure.ts";

export type HabitWindow = { from: number; to: number }; // minutes of the local day, from < to
export const NUDGE_CHANNELS = ["off", "toast", "push"] as const;
export type NudgeChannel = (typeof NUDGE_CHANNELS)[number];
export const isChannel = (v: unknown): v is NudgeChannel => (NUDGE_CHANNELS as readonly unknown[]).includes(v);
export const LEAD_MIN = 10, BACKOFF_AFTER = 2, BACKOFF_DAYS = 7, MAX_AT = 60;

const PRESETS: [RegExp, HabitWindow][] = [
  [/after lunch/, { from: 13 * 60, to: 15 * 60 }], [/before bed/, { from: 22 * 60, to: 23 * 60 + 30 }], [/morning/, { from: 7 * 60, to: 10 * 60 }],
  [/lunch/, { from: 12 * 60, to: 13 * 60 + 30 }], [/afternoon/, { from: 14 * 60, to: 17 * 60 }], [/evening/, { from: 19 * 60, to: 22 * 60 }], [/night/, { from: 21 * 60, to: 23 * 60 }],
];
const DAY_RE: [RegExp, number[]][] = [
  [/\bweekdays?\b/, [1, 2, 3, 4, 5]], [/\bweekends?\b/, [0, 6]], [/\bsun/, [0]], [/\bmon/, [1]], [/\btue/, [2]], [/\bwed/, [3]], [/\bthu/, [4]], [/\bfri/, [5]], [/\bsat/, [6]],
];

/** "evening 19–22", "after lunch", "on Mondays", "mon wed 7:30-8" → window (+ days when named), or null. Days alone → 09–21. */
export function parseWindow(text: unknown): { window: HabitWindow; days?: number[] } | null {
  if (typeof text !== "string" || text.length > 60) return null;
  const t = text.toLowerCase();
  const r = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?/.exec(t);
  const days = [...new Set(DAY_RE.filter(([re]) => re.test(t)).flatMap(([, d]) => d))].sort();
  let window = r ? { from: +r[1] * 60 + +(r[2] ?? 0), to: +r[3] * 60 + +(r[4] ?? 0) } : PRESETS.find(([re]) => re.test(t))?.[1];
  if (!window && days.length) window = { from: 9 * 60, to: 21 * 60 };
  if (!window || window.from >= window.to || window.to > 24 * 60 || (r && (+(r[2] ?? 0) > 59 || +(r[4] ?? 0) > 59))) return null;
  return days.length ? { window, days } : { window };
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const windowLabel = (w: HabitWindow) => `${hhmm(w.from)}–${hhmm(w.to)}`;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = s.length >> 1;
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
}

/** Minute of `day` to nudge: LEAD_MIN before his usual check-in time in the window, never outside it. No history → window start. */
export function nudgeMinute(h: Pick<Habit, "window" | "at">, day: string): number | null {
  const w = h.window;
  if (!w) return null;
  const inside = Object.entries(h.at ?? {}).filter(([, m]) => m >= w.from && m < w.to);
  const same = inside.filter(([k]) => weekday(k) === weekday(day)).map(([, m]) => m);
  const usual = median(same.length >= 2 ? same : inside.length >= 2 ? inside.map(([, m]) => m) : []);
  return usual === null ? w.from : Math.min(w.to - 1, Math.max(w.from, usual - LEAD_MIN));
}

/** Nudges ignored in a row: the last one counts once its day is over; any check-in on or after it resets the run. */
export function ignoredRun(h: Pick<Habit, "nudged" | "ignored" | "done">, today: string): number {
  if (!h.nudged || h.done.some((d) => d >= h.nudged!)) return 0;
  return (h.ignored ?? 0) + (h.nudged < today ? 1 : 0);
}
export const backedOff = (h: Pick<Habit, "nudged" | "ignored" | "done">, today: string) =>
  ignoredRun(h, today) >= BACKOFF_AFTER && addDays(h.nudged!, BACKOFF_DAYS) > today;

export type NudgeCtx = { quiet: boolean; focus: boolean; stop: boolean };
/** Nudge this habit now? Scheduled today, not done, not nudged yet today, inside [nudge minute, window end), not backed off. */
export function shouldNudge(h: Habit, day: string, min: number, ctx: NudgeCtx): boolean {
  if (!h.nudge || !h.window || ctx.quiet || ctx.focus || ctx.stop) return false;
  if (!h.days.includes(weekday(day)) || h.done.includes(day) || h.nudged === day) return false;
  const at = nudgeMinute(h, day)!;
  return min >= at && min < h.window.to && !backedOff(h, day);
}

/** Check-in minute history: one per day, newest MAX_AT days kept. */
export function recordAt(at: Record<string, number> | undefined, day: string, min: number | null): Record<string, number> {
  const next = { ...at };
  if (min === null) delete next[day]; else next[day] = min;
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-MAX_AT));
}

/** Last full week (Mon–Sun before today's week): check-ins done vs. scheduled, counts only. */
export function habitWeek(habits: Pick<Habit, "days" | "done" | "created">[], today: string): { done: number; due: number } {
  const start = addDays(weekStart(today), -7);
  let done = 0, due = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(start, i);
    for (const h of habits) if (h.days.includes(weekday(k)) && k >= h.created) { due++; if (h.done.includes(k)) done++; }
  }
  return { done, due };
}
