// STUDIO coach: turns one Analytics range into at most 3 plain findings, each with the one thing to do next.
// Pure and client-safe (no node imports); tested in tests/studio-coach.test.ts.
// Thresholds are ORBIT's own rules of thumb, not YouTube benchmarks, so findings compare the channel with itself where they can.

import { FEW_VIEWS } from "./chart-pure.ts";

type T = { views: number; subsGained: number; subsLost: number; likes: number; comments: number; shares: number };
export type CoachInput = {
  totals: T; prevTotals: T;
  traffic: { source: string; views: number }[];
  topVideos?: { id: string; views: number }[];
  engaged?: { cur: number; prev: number };
};
export type Finding = { level: "fix" | "good" | "info"; title: string; why: string; todo: string };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export function coach(d: CoachInput, titleOf: (id: string) => string | undefined = () => undefined): Finding[] {
  const v = fin(d.totals.views), pv = fin(d.prevTotals.views);
  if (v < FEW_VIEWS && pv < FEW_VIEWS) return [{
    level: "fix", title: `Only ${v} views in this range: too few to judge anything yet`,
    why: "YouTube shows each new Short to a small test audience first and widens it only if they watch. With few uploads there is nothing to learn from.",
    todo: "Post 1–2 Shorts a day for 30 days, each with your own hook or commentary. Your own game footage counts as original.",
  }];

  const out: Finding[] = [];
  const enough = v >= FEW_VIEWS; // shares of this period's views mean something only with enough of them (and never divide by 0)
  const top = d.topVideos?.[0];
  if (enough && top && top.views <= v && top.views / v >= 0.5) out.push({
    level: "good", title: `One video brought ${pct(top.views / v)} of your views`,
    why: `${titleOf(top.id) ? `“${titleOf(top.id)}”` : "Your top video"} is the format your audience wants right now.`,
    todo: "Make 3 more in the same format this week: same kind of moment, same length, a new twist each time.",
  });

  if (enough && d.engaged && pv >= FEW_VIEWS) {
    const r = fin(d.engaged.cur) / v, pr = fin(d.engaged.prev) / pv;
    if (r <= pr - 0.1) out.push({
      level: "fix", title: `Fewer viewers stayed past the start: ${pct(r)} engaged, down from ${pct(pr)}`,
      why: "Engaged views count viewers who kept watching. A drop means the opening of your recent Shorts loses people.",
      todo: "Start every Short on the payoff or a question in the first 2 seconds. Cut intros and logos.",
    });
    else if (r >= pr + 0.1) out.push({ level: "good", title: `More viewers stayed past the start: ${pct(r)} engaged, up from ${pct(pr)}`, why: "Your recent openings work better.", todo: "Keep the opening style of your last few Shorts." });
  }

  const shorts = d.traffic.find((t) => t.source === "SHORTS")?.views ?? 0;
  if (enough && shorts / v < 0.5) out.push({
    level: "info", title: `Only ${pct(shorts / v)} of views came from the Shorts feed`,
    why: "The feed is where new viewers find a Shorts channel. A low share means YouTube isn't widening your Shorts beyond the test audience yet.",
    todo: "Focus on rewatch and completion: shorter cuts (15–30 s), a loop at the end, one clear moment per Short.",
  });

  const net = fin(d.totals.subsGained) - fin(d.totals.subsLost);
  if (v >= 1000 && net <= 0) out.push({
    level: "fix", title: `${v.toLocaleString("en")} views but ${net === 0 ? "no new subscribers" : "you lost more subscribers than you gained"}`,
    why: "One-off clips get watched and forgotten. People subscribe when they expect more of the same.",
    todo: "Turn your best format into a numbered series (Part 1, 2, 3) and say what comes next in the last second.",
  });

  if (pv >= FEW_VIEWS && v >= pv * 1.3) out.push({ level: "good", title: `Views up ${pct(v / pv - 1)} on the previous period`, why: "Something you changed is working.", todo: "Check which videos drove it (Top videos) and repeat that." });
  else if (pv >= FEW_VIEWS && v <= pv * 0.7) out.push({ level: "fix", title: `Views down ${pct(1 - v / pv)} on the previous period`, why: "Fewer uploads or weaker openings are the usual causes.", todo: "Check your posting rhythm in Calendar first; then compare your top videos with the recent ones." });

  const order = { fix: 0, good: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 3);
}
