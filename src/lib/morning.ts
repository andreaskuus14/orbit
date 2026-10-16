import type { SupabaseClient } from "@supabase/supabase-js";
import { listDownloads, listJobs, readState, studioRoot } from "./clips/factory";
import { youtubePauseUntil } from "./clips/pure";
import { readPublishSettings } from "./clips/publish-schedule";
import { scoutView } from "./clips/scout";
import { learnProblem, type LearnState } from "./clips/learn-pure";
import { pickRecall, type Recall } from "./resurface-pure";
import { buildMorning, lifeSection, pulseHeadlines, studioSection, type Morning, type MorningAgents, type MorningIntel, type MorningStudio } from "./morning-pure";

// Gathers the "Good morning" briefing: every section in parallel with a timeout, a failing source just drops its section.
// Reads stored data only (no Pulse run, no YouTube stats fetch, no AI call).

const TIMEOUT_MS = 4000;
const OVERNIGHT_MS = 16 * 3_600_000; // same window as Pulse's morning briefing
const within = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
const ok = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : undefined);

async function studio(now: number, tz: string): Promise<MorningStudio> {
  const [jobs, downloads, learn, sv] = await Promise.all([
    listJobs(), listDownloads().catch(() => []),
    readState<LearnState>(studioRoot(), "learn", learnProblem).catch(() => null), scoutView().catch(() => null),
  ]);
  const views = Object.fromEntries(Object.entries(learn?.clips ?? {}).flatMap(([id, r]) => (r.latest ? [[id, r.latest.views]] : [])));
  const s = sv?.scout;
  return studioSection({
    clips: jobs.flatMap((j) => j.clips), views, tz,
    pausedUntil: youtubePauseUntil(downloads, "https://www.youtube.com/", now),
    scout: s ? { newPicks: s.picks.filter((p) => p.status === "new").length, topNiche: [...(s.niche?.niches ?? [])].sort((a, b) => b.score - a.score)[0]?.name } : null,
  }, now);
}

async function intel(sb: SupabaseClient): Promise<MorningIntel> {
  const { data, error } = await sb.from("briefings").select("title, content, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "no briefing yet");
  return { title: data.title, at: data.created_at, headlines: pulseHeadlines(data.content ?? "") };
}

async function agents(sb: SupabaseClient, now: number): Promise<MorningAgents> {
  const since = new Date(now - OVERNIGHT_MS).toISOString();
  const [tasks, props] = await Promise.all([
    sb.from("tasks").select("title, status").is("parent_id", null).in("status", ["done", "failed"]).gte("finished_at", since).limit(50),
    sb.from("proposals").select("title").eq("status", "pending").limit(20), // missing table (migration 0006) → just no proposals
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  const t = tasks.data ?? [];
  return { done: t.filter((x) => x.status === "done").map((x) => x.title), failed: t.filter((x) => x.status === "failed").length, proposals: (props.data ?? []).map((p) => p.title) };
}

// shortcut: only the 500 newest memories older than 6 days are candidates, so older anniversaries are missed; add a date-filtered query if that matters.
async function recall(sb: SupabaseClient, now: number, tz: string): Promise<Recall[]> {
  const { data, error } = await sb.from("memories").select("id, title, kind, created_at").neq("kind", "conversation")
    .lt("created_at", new Date(now - 6 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return pickRecall(data ?? [], now, tz);
}

export async function getMorning(sb: SupabaseClient, now = Date.now()): Promise<Morning> {
  const tz = (await readPublishSettings().catch(() => null))?.timezone || "Europe/Tallinn";
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone; // LIFE and memory anniversaries use the PC's local days, not the publish timezone
  const [s, i, a, l, r] = await Promise.allSettled([within(studio(now, tz)), within(intel(sb)), within(agents(sb, now)),
    within(import("./life").then((m) => m.getLife()).then((st) => lifeSection(st, now, localTz))), within(recall(sb, now, localTz))]);
  const life = ok(l), rec = ok(r);
  return buildMorning({ studio: ok(s), intel: ok(i), agents: ok(a), life: life && (life.habits || life.next) ? life : undefined, recall: rec?.length ? rec : undefined }, now, tz);
}
