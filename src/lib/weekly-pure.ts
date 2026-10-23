// Sunday-evening weekly review (pure, tested in tests/weekly.test.ts): what moved, what didn't, one experiment for next week.
// Built from stored data only, no AI call, so it's instant and free. Gathering: weekly.ts.
export type WeeklyIn = {
  shorts: { title: string; views: number | null; publishedAt: string }[]; // published in the last 7 days
  prevShortsViews: number | null; // total views of the week before's Shorts, for the trend (null = unknown)
  business: { contacted: number; replied: number; pilots: number; paying: number };
  agents: { done: number; failed: number };
  memories: number; // saved this week
};
export type Weekly = { lines: string[]; best: { title: string; views: number } | null; experiment: string; spoken: string };

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
  // One experiment, from the weakest lever (Shorts volume → hooks → outreach → keep going).
  const experiment = x.shorts.length < 5 ? "Publish one Short a day: let autopilot keep the 7-Short buffer full and approve each morning."
    : best && views / x.shorts.length < 100 ? "Run the Hook lab on your next 3 clips and post the predicted winner: the first second decides the swipe."
    : x.business.contacted < 5 ? "Contact 5 businesses this week: research each one first, then send the draft that names something real about them."
    : "Keep the rhythm, and double the format of your best Short.";
  const spoken = [`Here's your week.`, ...lines, best ? `Your best Short was ${best.title}, with ${best.views.toLocaleString("en")} views.` : "", `One experiment for next week: ${experiment}`].filter(Boolean).join(" ");
  return { lines, best, experiment, spoken };
}

/** Sunday from 18:00 local, once per week (keyed by the date of that Sunday). */
export const weeklyDue = (now: Date, lastShownKey: string | null) =>
  now.getDay() === 0 && now.getHours() >= 18 && lastShownKey !== now.toISOString().slice(0, 10);
