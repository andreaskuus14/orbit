// ANALYTICS → LIFE stats card: pure summaries of GET /api/life. Tested in tests/life-stats.test.ts.
import type { HabitView } from "./life-pure.ts";

export type DayPct = { date: string; scheduled: number; done: number; pct: number | null }; // pct null = nothing scheduled

/** Per day of the last 7 (oldest first): share of scheduled habits done, from each habit's week dots. */
export function weekCompletion(habits: Pick<HabitView, "week">[]): DayPct[] {
  const days = habits[0]?.week.map((d) => ({ date: d.date, scheduled: 0, done: 0, pct: null as number | null })) ?? [];
  for (const h of habits) h.week.forEach((d, i) => {
    const day = days[i];
    if (!day || !d.scheduled) return;
    day.scheduled++;
    if (d.done) day.done++;
  });
  for (const d of days) d.pct = d.scheduled ? Math.round((d.done / d.scheduled) * 100) : null;
  return days;
}

export function todayCount(habits: Pick<HabitView, "scheduledToday" | "doneToday">[]): { done: number; total: number } {
  const t = habits.filter((h) => h.scheduledToday);
  return { done: t.filter((h) => h.doneToday).length, total: t.length };
}

/** Habit with the longest current streak (first wins ties); null when no streak is running. */
export function bestStreak<H extends Pick<HabitView, "streak">>(habits: H[]): H | null {
  return habits.reduce<H | null>((b, h) => (h.streak > (b?.streak ?? 0) ? h : b), null);
}
