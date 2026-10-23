import type { SupabaseClient } from "@supabase/supabase-js";
import { listDownloads, listJobs, readState, studioRoot } from "./clips/factory";
import { youtubePauseUntil } from "./clips/pure";
import { readPublishSettings } from "./clips/publish-schedule";
import { scoutView } from "./clips/scout";
import { learnProblem, type LearnState } from "./clips/learn-pure";
import { pickRecall, type Recall } from "./resurface-pure";
import { getContinueWork } from "./work-continuation";
import { dailyMission } from "./daily-mission-pure";
import { dueFollowups } from "./business-pure";
import { readSleepReport } from "./sleep";
import { alertText } from "./markets-pure";
import { morningCandidates, rankCards, type Thumb } from "./morning-rank-pure";
import { buildMorning, businessFollowupLine, localDay, overnightLine, lifeSection, pulseHeadlines, sinceSection, studioSection, type Morning, type MorningAgents, type MorningIntel, type MorningSince, type MorningStudio } from "./morning-pure";

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

/** "Since you left": each source on its own timeout; a failing one just counts as nothing new. */
export async function getSince(sb: SupabaseClient, from: number, now = Date.now()): Promise<MorningSince> {
  const [t, j, l, m, ap] = await Promise.allSettled([
    within(Promise.resolve(sb.from("tasks").select("status").is("parent_id", null).in("status", ["done", "failed"]).gte("finished_at", new Date(from).toISOString()).limit(200))
      .then((r) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; })),
    within(listJobs()),
    within(import("./life").then((x) => x.exportLife())), // raw store: getLife() hides reminders older than a day
    within(import("./markets").then((x) => x.listAlerts())),
    within(Promise.resolve(sb.from("tasks").select("id", { count: "exact", head: true }).is("parent_id", null).eq("status", "awaiting_approval"))
      .then((r) => { if (r.error) throw new Error(r.error.message); return r.count ?? 0; })),
  ]);
  return sinceSection({ tasks: ok(t) ?? [], jobs: ok(j) ?? [], reminders: ok(l)?.reminders ?? [], alerts: ok(m) ?? [], approvals: ok(ap) }, from, now);
}

/** Businesses moved to "contacted" or later today (BUSINESS pipeline, RLS-scoped to the signed-in user). */
// shortcut: uses updated_at, so editing an already-contacted business today also counts; add a contacted_at column if that matters.
async function contactedToday(sb: SupabaseClient, now: number, tz: string): Promise<number> {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t);
  const { data, error } = await sb.from("prospects").select("stage, updated_at").in("stage", ["contacted", "replied", "pilot", "paying"]).gte("updated_at", new Date(now - 36 * 3600_000).toISOString());
  if (error) throw error;
  return (data ?? []).filter((p) => day(Date.parse(p.updated_at)) === day(now)).length;
}

/** 👍/👎 from the last 60 days of the ledger (newest 500). */
async function thumbs(sb: SupabaseClient, now: number): Promise<Thumb[]> {
  const { data, error } = await sb.from("events").select("created_at, payload").eq("type", "morning.thumb")
    .gte("created_at", new Date(now - 60 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((r) => {
    const p = r.payload as Partial<Thumb> | null;
    return p && typeof p.kind === "string" && typeof p.key === "string" && typeof p.up === "boolean" ? [{ kind: p.kind, key: p.key, up: p.up, at: r.created_at }] : [];
  });
}

/** Approvals waiting: the list keeps 6 items with approvals first, so a full list of them may hide more. */
const approvals = (w: { items: { status: string }[]; more: number }) => {
  const k = w.items.filter((x) => x.status === "awaiting_approval").length;
  return k === w.items.length ? k + w.more : k;
};

export async function getMorning(sb: SupabaseClient, userId: string, now = Date.now(), from: number | null = null): Promise<Morning> {
  const tz = (await readPublishSettings().catch(() => null))?.timezone || "Europe/Tallinn";
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone; // LIFE and memory anniversaries use the PC's local days, not the publish timezone
  const cardSources = Promise.allSettled([within(thumbs(sb, now)), within(import("./markets").then((x) => x.listAlerts())), within(import("./ideas").then((x) => x.listIdeas()))]);
  const [s, i, a, l, r, sn, c, w, ct, bf] = await Promise.allSettled([within(studio(now, tz)), within(intel(sb)), within(agents(sb, now)),
    within(import("./life").then((m) => m.getLife()).then((st) => lifeSection(st, now, localTz))), within(recall(sb, now, localTz)),
    from === null ? Promise.resolve(undefined) : getSince(sb, from, now),
    // Same cache entry as the LIFE card. No Google client configured → no calendar section at all.
    within(Promise.all([import("./gcal"), import("./gcal-pure")]).then(async ([g, p]) => {
      if (!g.calEnv()) return undefined;
      const ev = await g.calendarEvents(7, now);
      return { connected: !!ev, today: ev ? p.todayEvents(ev, now) : [] };
    })), within(getContinueWork(sb, userId)), within(contactedToday(sb, now, tz)),
    within(Promise.resolve(sb.from("prospects").select("id,name,stage,updated_at,notes").eq("stage", "contacted")).then(({ data, error }) => {
      if (error) throw error;
      return dueFollowups(data ?? [], now);
    }))]);
  const [th, al, ids] = await cardSources;
  const life = ok(l), rec = ok(r), since = ok(sn), work = ok(w), st = ok(s), due = ok(bf);
  const today = localDay(new Date(now)); // markets' firedOn is a server-local day
  const cards = rankCards(morningCandidates({ work, studioReady: st?.ready, proposals: ok(a)?.proposals, headlines: ok(i)?.headlines,
    alerts: ok(al)?.filter((x) => x.firedOn === today).map(alertText), followups: due, recall: rec, ideas: ok(ids)?.shown }), ok(th) ?? [], now);
  // Only counted when its sources loaded: a mission ticked from missing data would be a false claim.
  const mission = st && work && ok(ct) !== undefined ? dailyMission({ shortsToday: st.today.length, contactedToday: ok(ct)!, approvalsWaiting: approvals(work) }) : undefined;
  return { ...buildMorning({ studio: ok(s), intel: ok(i), agents: ok(a), life: life && (life.habits || life.next) ? life : undefined, calendar: ok(c), recall: rec?.length ? rec : undefined,
    business: due && businessFollowupLine(due.length), overnight: overnightLine(await readSleepReport(userId).catch(() => undefined), localDay(new Date(now))), work: work ?? { items: [], more: 0, problems: ["Unfinished work could not be loaded."] }, mission }, now, tz), cards, ...(since && { since }) };
}
