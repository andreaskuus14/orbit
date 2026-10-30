// LIF08 weekly review (pure, tested in tests/life-week.test.ts): the last 7 days from local LIFE data only. Outcomes, how close
// the accepted plans were to what got done, friction (pushed back or missed more than once) and one habit worth adjusting.
// Missing data is listed, never guessed. Takes the LIFE store but never reads the journal: nothing here goes to a model anyway.
import { addDays, scheduledOn, type LifeStore } from "./life-pure.ts";
import type { DayStat, Deferred } from "./dayplan-pure.ts";

export type Missing = "plans" | "habits" | "focus" | "school";
export type Adjust = { id: string; name: string; rate: number; suggest: "target" | "goal" | "days" };
export type WeekReview = {
  from: string; to: string;
  outcomes: { tasksDone: number; tasksPlanned: number; focusMin: number; habitsDone: number; habitsDue: number; schoolDone: string[] };
  accuracy: { plannedMin: number; doneMin: number; pct: number; days: number } | null;
  friction: { title: string; deferred: number; missed: number }[];
  adjust: Adjust | null;
  missing: Missing[];
};
type SchoolLite = { title: string; done?: boolean; doneAt?: string };

export function weekReview(x: { life: Pick<LifeStore, "habits" | "focus">; history: DayStat[]; deferred: Deferred[]; school: SchoolLite[] | null; today: string }): WeekReview {
  const from = addDays(x.today, -6), to = x.today, inWeek = (k: string) => k >= from && k <= to;
  const days = x.history.filter((d) => inWeek(d.day) && d.plannedMin > 0);
  let habitsDone = 0, habitsDue = 0;
  const rates = x.life.habits.map((h) => {
    let due = 0, done = 0;
    for (let i = 0; i < 7; i++) { const k = addDays(from, i); if (k < h.created || !scheduledOn(h, k)) continue; due++; if (h.done.includes(k)) done++; }
    if (h.target) due = Math.min(due, h.target);
    done = Math.min(done, due); habitsDue += due; habitsDone += done;
    return { h, due, rate: due ? done / due : 1 };
  });
  const low = rates.filter((r) => r.due >= 2 && r.rate < 0.5).sort((a, b) => a.rate - b.rate)[0];
  const adjust: Adjust | null = low ? { id: low.h.id, name: low.h.name, rate: Math.round(low.rate * 100) / 100,
    suggest: low.h.goal ? "goal" : low.h.target || low.h.days.length === 7 ? "target" : "days" } : null;
  const plannedMin = days.reduce((n, d) => n + d.plannedMin, 0), doneMin = days.reduce((n, d) => n + d.doneMin, 0);
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const fr = new Map<string, { title: string; deferred: number; missed: number }>();
  const get = (t: string) => fr.get(key(t)) ?? fr.set(key(t), { title: t, deferred: 0, missed: 0 }).get(key(t))!;
  for (const d of days) for (const m of d.missed ?? []) get(m).missed++;
  for (const d of x.deferred) if (inWeek(d.at.slice(0, 10))) get(d.title).deferred += d.n;
  const focusMin = Object.entries(x.life.focus).filter(([k]) => inWeek(k)).reduce((n, [, m]) => n + m, 0);
  const missing: Missing[] = [
    ...(days.length ? [] : ["plans" as const]), ...(x.life.habits.length ? [] : ["habits" as const]),
    ...(focusMin ? [] : ["focus" as const]), ...(x.school ? [] : ["school" as const]),
  ];
  return {
    from, to,
    outcomes: { tasksDone: days.reduce((n, d) => n + (d.done ?? 0), 0), tasksPlanned: days.reduce((n, d) => n + (d.planned ?? 0), 0), focusMin, habitsDone, habitsDue,
      schoolDone: (x.school ?? []).filter((i) => i.done && i.doneAt && inWeek(i.doneAt.slice(0, 10))).map((i) => i.title) },
    accuracy: days.length ? { plannedMin, doneMin, pct: Math.round((doneMin / plannedMin) * 100), days: days.length } : null,
    friction: [...fr.values()].filter((f) => f.deferred + f.missed >= 2).sort((a, b) => b.deferred + b.missed - (a.deferred + a.missed)).slice(0, 5),
    adjust, missing,
  };
}
