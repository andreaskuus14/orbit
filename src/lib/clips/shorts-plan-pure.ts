// Shorts autopilot v2 (roadmap B4), pure; tested in tests/shorts-plan.test.ts. IO: shorts-plan.ts, API: /api/studio/shorts-plan, UI: ShortsBoard.
// A weekly plan to reach the target of Shorts in review: pick ideas (IDEA RADAR, comment ideas, Day-N Roblox sessions, trends; kept lessons
// nudge the sources), write talking-drama scripts and get Higgsfield quotes overnight (get_cost only), then offer ONE morning batch
// "Approve 3 Shorts for 210 credits" that fits the weekly cap. Nothing is generated or spent before that click.
import { DEFAULT_WEEKLY_TARGET, ideaSeed, validTarget } from "./pipeline-pure.ts";
import type { Idea } from "../ideas-pure.ts";

export const PLAN_SOURCES = ["radar", "comments", "roblox", "trend"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];
export const NIGHT_WRITES = 3; // new scripts per night (one Claude call each)
export const PER_SOURCE = 3; // picks per source per week, so one noisy source can't fill the week
export const USED_MAX = 300;

export type Cand = { key: string; source: PlanSource; title: string; idea: string; score: number }; // score 0..1
export type Pick = Cand & { at: string; story?: string };
export type ShortsPlan = { v: 1; week: number; target: number; picks: Pick[]; used: string[] }; // used: candidate keys ever picked (no repeats across weeks)

export const emptyPlan = (week: number, target = DEFAULT_WEEKLY_TARGET): ShortsPlan => ({ v: 1, week, target: validTarget(target), picks: [], used: [] });
export const planProblem = (x: unknown) => ((x as ShortsPlan)?.v === 1 && Array.isArray((x as ShortsPlan).picks) && Array.isArray((x as ShortsPlan).used) ? "" : "not a shorts plan");

/** A new week carries over only picks whose story is still on its way (`live` story ids); the keys of all stay used. */
export const rollWeek = (p: ShortsPlan, week: number, live: string[] = []): ShortsPlan =>
  p.week === week ? p : { v: 1, week, target: validTarget(p.target), picks: p.picks.filter((x) => x.story && live.includes(x.story)), used: p.used.slice(-USED_MAX) };

type IdeaLike = { id: string; title: string; summary: string; area: string; score: number; dismissed?: boolean; origin?: Idea["origin"] };
/** STUDIO ideas from IDEA RADAR (comment ideas and Day-N Roblox sessions live there too). The seed matches the pipeline board's. */
export const ideaCands = (ideas: IdeaLike[]): Cand[] => ideas.filter((i) => i.area === "studio" && !i.dismissed && i.origin !== "transcript").map((i) => ({
  key: `idea:${i.id}`, source: i.origin === "comments" ? "comments" : i.origin === "devsession" ? "roblox" : "radar", title: i.title, idea: ideaSeed(i),
  score: Math.max(0, Math.min(1, i.score / 100)) }));

/** Trend Radar: rising Roblox games and hot YouTube topics as drama premises (scored below most hand-picked ideas). */
export function trendCands(t: { risers?: { name: string; strong: boolean }[]; topics?: { term: string; count: number }[] }): Cand[] {
  const r = (t.risers ?? []).slice(0, 3).map((x): Cand => ({ key: `trend:roblox:${x.name.toLowerCase()}`, source: "trend", title: `Trending: ${x.name}`.slice(0, 120),
    idea: `A talking-drama Short riffing on the Roblox game "${x.name}" that is suddenly trending: the characters argue about it.`, score: x.strong ? 0.72 : 0.62 }));
  const y = (t.topics ?? []).slice(0, 3).map((x): Cand => ({ key: `trend:yt:${x.term.toLowerCase()}`, source: "trend", title: `Trending: ${x.term}`.slice(0, 120),
    idea: `A talking-drama Short about "${x.term}", a topic trending on YouTube right now.`, score: Math.min(0.7, 0.55 + 0.03 * x.count) }));
  return [...r, ...y];
}

/** How many more scripts the week needs: target minus what's booked, in review/approved, or already in this plan's flight. */
export const weekNeed = (a: { target: number; booked: number; ready: number; inFlight: number }) => Math.max(0, a.target - a.booked - a.ready - a.inFlight);

/** Up to `need` candidates, best first, never one already used or written, at most PER_SOURCE per source this week (counting `picked`). */
export function pickIdeas(cands: Cand[], need: number, used: string[], written: string[], picked: Pick[] = []): Cand[] {
  const skip = new Set(used), seeds = new Set(written.map((w) => w.trim())), per = new Map<PlanSource, number>();
  for (const p of picked) per.set(p.source, (per.get(p.source) ?? 0) + 1);
  const out: Cand[] = [];
  for (const c of [...cands].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))) {
    if (out.length >= need) break;
    if (skip.has(c.key) || seeds.has(c.idea.trim()) || (per.get(c.source) ?? 0) >= PER_SOURCE) continue;
    skip.add(c.key); per.set(c.source, (per.get(c.source) ?? 0) + 1); out.push(c);
  }
  return out;
}

export type StoryState = { id: string; status: string; quoted: boolean; credits: number; ok: boolean; madeAny: boolean }; // ok: approveProblem(job, credits) === ""
/** Tonight's work on the plan: picks to script (≤ NIGHT_WRITES) and autopilot stories that need a fresh quote. */
export function nightTodo(plan: ShortsPlan, stories: StoryState[]): { write: Pick[]; quote: string[] } {
  const by = new Map(stories.map((s) => [s.id, s]));
  return {
    write: plan.picks.filter((p) => !p.story).slice(0, NIGHT_WRITES),
    quote: plan.picks.flatMap((p) => { const s = p.story ? by.get(p.story) : undefined; return s && (s.status === "draft" || s.status === "quoted") && !s.quoted ? [s.id] : []; }),
  };
}

/** Picks still on their way to review: no script yet, or a story that isn't done (then it's a clip) or failed. */
export const inFlight = (plan: ShortsPlan, stories: StoryState[]) =>
  plan.picks.filter((p) => { const s = stories.find((x) => x.id === p.story); return !p.story || (!!s && s.status !== "done" && s.status !== "failed"); }).length;

export type BatchItem = { id: string; title: string; credits: number; part: "characters" | "shots" };
export type Batch = { items: BatchItem[]; credits: number; label: string; held: number; why?: string };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The one morning click: every plan story with a valid quote, in plan order (best idea first), as many as fit the weekly cap.
 *  held: quoted stories left for next week's cap (or a raised cap). */
export function morningBatch(plan: ShortsPlan, stories: StoryState[], titles: Record<string, string>, spent: number, cap: number): Batch {
  const by = new Map(stories.map((s) => [s.id, s]));
  const ready = plan.picks.flatMap((p) => { const s = p.story ? by.get(p.story) : undefined; return s && s.quoted && s.ok && s.credits > 0 ? [{ s, p }] : []; });
  const items: BatchItem[] = [];
  let sum = 0;
  for (const { s, p } of ready) {
    if (round2(spent + sum + s.credits) > cap) continue; // a cheaper later one may still fit
    sum = round2(sum + s.credits);
    items.push({ id: s.id, title: titles[s.id] || p.title, credits: s.credits, part: s.madeAny ? "shots" : "characters" });
  }
  const held = ready.length - items.length, n = items.length;
  const why = held ? `${held} more ${held > 1 ? "wait" : "waits"} for the weekly cap (${spent} of ${cap} credits used)` : undefined;
  return { items, credits: sum, label: n ? `Approve ${n} Short${n > 1 ? "s" : ""} for ${sum} credits` : "", held, ...(why ? { why } : {}) };
}

/** The click must name exactly the batch the server computes now (same stories, same total), or nothing is approved. */
export function batchProblem(b: Batch, ids: unknown, credits: unknown): string {
  if (!b.items.length) return "Nothing is waiting for approval";
  if (!Array.isArray(ids) || ids.length !== b.items.length || !b.items.every((i) => ids.includes(i.id))) return "The batch changed: refresh and check it again";
  if (credits !== b.credits) return `Approve the batch total (${b.credits} credits)`;
  return "";
}
