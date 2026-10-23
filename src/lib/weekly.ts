import type { SupabaseClient } from "@supabase/supabase-js";
import { listJobs, readState, studioRoot } from "./clips/factory";
import { learnProblem, type LearnState } from "./clips/learn-pure";
import { weeklyReview, type Weekly } from "./weekly-pure";

// Gathers the week (stored data only, RLS-scoped). A failing source counts as nothing rather than failing the review.
const WEEK = 7 * 86_400_000;

export async function getWeekly(sb: SupabaseClient, now = Date.now()): Promise<Weekly> {
  const since = new Date(now - WEEK).toISOString();
  const [jobs, learn, prospects, tasks, mems] = await Promise.all([
    listJobs().catch(() => []),
    readState<LearnState>(studioRoot(), "learn", learnProblem).catch(() => null),
    Promise.resolve(sb.from("prospects").select("stage").gte("updated_at", since).limit(500)).then((r) => r.data ?? [], () => []),
    Promise.resolve(sb.from("tasks").select("status").is("parent_id", null).in("status", ["done", "failed"]).gte("finished_at", since).limit(500)).then((r) => r.data ?? [], () => []),
    Promise.resolve(sb.from("memories").select("id", { count: "exact", head: true }).gte("created_at", since)).then((r) => r.count ?? 0, () => 0),
  ]);
  const views = (vid?: string) => (vid && learn?.clips[vid]?.latest ? learn.clips[vid].latest!.views : null);
  const published = jobs.flatMap((j) => j.clips).filter((c) => c.publish?.status === "done" && c.publish.videoId);
  const inWeek = (t: string, from: number, to: number) => { const x = Date.parse(t); return x >= from && x < to; };
  const shorts = published.filter((c) => inWeek(c.publish!.at, now - WEEK, now)).map((c) => ({ title: c.publish?.title ?? c.title, views: views(c.publish!.videoId), publishedAt: c.publish!.at }));
  const prev = published.filter((c) => inWeek(c.publish!.at, now - 2 * WEEK, now - WEEK)).map((c) => views(c.publish!.videoId));
  const count = (s: string[]) => prospects.filter((p) => s.includes(p.stage)).length;
  return weeklyReview({
    shorts, prevShortsViews: prev.length && prev.every((v) => v !== null) ? (prev as number[]).reduce((a, b) => a + b, 0) : null,
    business: { contacted: count(["contacted", "replied", "pilot", "paying"]), replied: count(["replied", "pilot", "paying"]), pilots: count(["pilot"]), paying: count(["paying"]) },
    agents: { done: tasks.filter((t) => t.status === "done").length, failed: tasks.filter((t) => t.status === "failed").length },
    memories: mems,
  });
}
