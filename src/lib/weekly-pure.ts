// Sunday-evening weekly review (pure, tested in tests/weekly.test.ts): what moved, what didn't, one experiment for next week.
// Built from stored data only, no AI call, so it's instant and free. Gathering: weekly.ts.
export type WeeklyIn = {
  shorts: { title: string; views: number | null; publishedAt: string }[]; // published in the last 7 days
  prevShortsViews: number | null; // total views of the week before's Shorts, for the trend (null = unknown)
  business: { contacted: number; replied: number; pilots: number; paying: number };
  agents: { done: number; failed: number };
  memories: number; // saved this week
  experiments?: ExperimentStatus; // last week's experiment goal, and whether next week's is already added
};
export type Weekly = { lines: string[]; best: { title: string; views: number } | null; experiment: string; spoken: string; nextAdded: boolean };

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function weeklyReview(x: WeeklyIn): Weekly {
  const counted = x.shorts.filter((s) => s.views !== null) as { title: string; views: number }[];
  const views = counted.reduce((a, s) => a + s.views, 0);
  const top = counted.length ? counted.reduce((a, b) => (b.views > a.views ? b : a)) : null;
  const best = top && { title: top.title, views: top.views };
  const trend = x.prevShortsViews && counted.length ? Math.round(((views - x.prevShortsViews) / x.prevShortsViews) * 100) : null;
  const lines = [
    x.shorts.length ? `${n(x.shorts.length, "Short")} published, ${views.toLocaleString("en")} views${trend !== null ? ` (${trend >= 0 ? "+" : ""}${trend}% vs last week)` : ""}.` : "No Shorts published this week.",
    `Business: ${n(x.business.contacted, "business", "businesses")} contacted, ${x.business.replied} replied${x.business.pilots ? `, ${n(x.business.pilots, "pilot")}` : ""}${x.business.paying ? `, ${x.business.paying} paying` : ""}.`,
    `Agents finished ${n(x.agents.done, "task")}${x.agents.failed ? `, ${x.agents.failed} failed` : ""}. You saved ${n(x.memories, "memory", "memories")}.`,
  ];
  const last = x.experiments?.last;
  if (last) lines.push(last.done ? `Last week's experiment is done: ${last.title}.` : `Last week's experiment wasn't done: ${last.title}.`);
  // One experiment, from the weakest lever (Shorts volume → hooks → outreach → keep going).
  const experiment = x.shorts.length < 5 ? "Publish one Short a day: let autopilot keep the 7-Short buffer full and approve each morning."
    : best && views / x.shorts.length < 100 ? "Run the Hook lab on your next 3 clips and post the predicted winner: the first second decides the swipe."
    : x.business.contacted < 5 ? "Contact 5 businesses this week: research each one first, then send the draft that names something real about them."
    : "Keep the rhythm, and double the format of your best Short.";
  const spoken = [`Here's your week.`, ...lines, best ? `Your best Short was ${best.title}, with ${best.views.toLocaleString("en")} views.` : "", `One experiment for next week: ${experiment}`].filter(Boolean).join(" ");
  return { lines, best, experiment, spoken, nextAdded: !!x.experiments?.nextAdded };
}

/** Local Monday "YYYY-MM-DD" of the week containing d. */
export function weekKey(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}
const addDays = (d: Date, k: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, d.getHours());
const MARK = /^From your weekly review, for the week of (\d{4}-\d{2}-\d{2})\./;

/** "Add to next week": a POST /api/goals body (a draft goal; its plan still waits for the owner's approval). On Sunday the
 *  target is the coming week, any other day the current one. Manual metric: the owner sets 1 when he did it. */
export function experimentGoal(experiment: string, now: Date) {
  const week = weekKey(addDays(now, 1)), sunday = addDays(new Date(`${week}T12:00:00`), 6);
  return {
    title: `Experiment: ${experiment}`.slice(0, 200),
    why: `From your weekly review, for the week of ${week}. Set the metric to 1 once you've done it.`,
    metric: { kind: "manual", how: "1 = done this week", target: 1 },
    deadline: `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`,
    agents: ["nova", "atlas", "forge"], // CORE's create_goal defaults
  };
}

type GoalDoc = { title: string; why: string; status: string; metric: { kind: string; target?: number; samples: { value: number }[] } };
export type ExperimentStatus = { last: { title: string; done: boolean } | null; nextAdded: boolean };
/** The review's week (ending now; on Monday still last week) and whether the coming week's experiment is already a goal. */
export function experimentStatus(goals: GoalDoc[], now: Date): ExperimentStatus {
  const of = (week: string) => goals.find((g) => MARK.exec(g.why ?? "")?.[1] === week);
  const g = of(weekKey(addDays(now, -1)));
  const s = g?.metric.samples.at(-1);
  const done = !!g && (g.status === "done" || (g.metric.kind === "manual" && !!s && s.value >= (g.metric.target ?? 1)));
  return { last: g ? { title: g.title.replace(/^Experiment: /, ""), done } : null, nextAdded: !!of(weekKey(addDays(now, 1))) };
}

/** Sunday from 18:00 local, once per week (keyed by the date of that Sunday). */
export const weeklyDue = (now: Date, lastShownKey: string | null) =>
  now.getDay() === 0 && now.getHours() >= 18 && lastShownKey !== now.toISOString().slice(0, 10);
