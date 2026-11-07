import type { SupabaseClient } from "@supabase/supabase-js";
import { listDownloads, listJobs, readState, studioRoot } from "./clips/factory";
import { youtubePauseUntil } from "./clips/pure";
import { readPublishSettings } from "./clips/publish-schedule";
import { scoutView } from "./clips/scout";
import { learnProblem, type LearnState } from "./clips/learn-pure";
import { pmMorning, postmortemProblem, type PostMortemState } from "./clips/postmortem-pure";
import { pickRecall, type Recall } from "./resurface-pure";
import { isCurrent } from "./memory-types-pure";
import { getContinueWork } from "./work-continuation";
import { dailyMission } from "./daily-mission-pure";
import { taskVerified } from "./completion-pure";
import { dueFollowups } from "./business-pure";
import { readSleepReport } from "./sleep";
import { alertText } from "./markets-pure";
import { QUIET_MS, devBacklog, dropDone, goalDeadlines, morningCandidates, pickHero, rankCards, type Click, type Thumb } from "./morning-rank-pure";
import { validateDevWorld } from "./devworld-pure";
import { dayKey, safeZone } from "./agent-stats-pure";
import { buildMorning, businessFollowupLine, localDay, overnightLine, lifeSection, pulseHeadlines, sinceSection, studioSection, type Morning, type MorningAgents, type MorningIntel, type MorningSince, type MorningStudio } from "./morning-pure";

// Gathers the "Good morning" briefing: every section in parallel with a timeout, a failing source just drops its section.
// Reads stored data only (no Pulse run, no YouTube stats fetch, no AI call).

const TIMEOUT_MS = 4000;
const OVERNIGHT_MS = 16 * 3_600_000; // same window as Pulse's morning briefing
const within = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
const ok = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : undefined);

async function studio(now: number, tz: string): Promise<MorningStudio> {
  const [jobs, downloads, learn, sv, pm] = await Promise.all([
    listJobs(), listDownloads().catch(() => []),
    readState<LearnState>(studioRoot(), "learn", learnProblem).catch(() => null), scoutView().catch(() => null),
    readState<PostMortemState>(studioRoot(), "postmortem", postmortemProblem).catch(() => null),
  ]);
  const views = Object.fromEntries(Object.entries(learn?.clips ?? {}).flatMap(([id, r]) => (r.latest ? [[id, r.latest.views]] : [])));
  const s = sv?.scout;
  const sec = studioSection({
    clips: jobs.flatMap((j) => j.clips), views, tz,
    pausedUntil: youtubePauseUntil(downloads, "https://www.youtube.com/", now),
    scout: s ? { newPicks: s.picks.filter((p) => p.status === "new").length, topNiche: [...(s.niche?.niches ?? [])].sort((a, b) => b.score - a.score)[0]?.name } : null,
  }, now);
  return { ...sec, scout: [sec.scout, pmMorning(pm)].filter(Boolean).join(" ") }; // + "N post-mortem rules to review."
}

async function intel(sb: SupabaseClient): Promise<MorningIntel> {
  const { data, error } = await sb.from("briefings").select("title, content, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "no briefing yet");
  return { title: data.title, at: data.created_at, headlines: pulseHeadlines(data.content ?? "") };
}

async function agents(sb: SupabaseClient, now: number): Promise<MorningAgents> {
  const since = new Date(now - OVERNIGHT_MS).toISOString();
  const [tasks, props] = await Promise.all([
    sb.from("tasks").select("title, status, pending").is("parent_id", null).in("status", ["done", "failed"]).gte("finished_at", since).limit(50),
    sb.from("proposals").select("title").eq("status", "pending").limit(20), // missing table (migration 0006) → just no proposals
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  const t = tasks.data ?? [];
  // shortcut: only the root task's own actions count as evidence (sub-task receipts are missed, so this undercounts); join children if it matters.
  const verified = t.filter((x) => taskVerified(x.status, Array.isArray(x.pending) ? x.pending : [])).length;
  return { done: t.filter((x) => x.status === "done").map((x) => x.title), failed: t.filter((x) => x.status === "failed").length, proposals: (props.data ?? []).map((p) => p.title), verified };
}

// shortcut: only the 500 newest memories older than 6 days are candidates, so older anniversaries are missed; add a date-filtered query if that matters.
async function recall(sb: SupabaseClient, now: number, tz: string): Promise<Recall[]> {
  const { data, error } = await sb.from("memories").select("id, title, kind, created_at, tags, content").not("kind", "in", "(conversation,journal)") // journal entries are LIFE: never resurfaced
    .lt("created_at", new Date(now - 6 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return pickRecall((data ?? []).filter((m) => isCurrent(m, { now })), now, tz); // no lapsed, chat- or project-scoped instructions in the brief
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

/** Hero/card clicks and "done" marks from the last 14 days of the ledger (newest 500). */
async function clicks(sb: SupabaseClient, now: number): Promise<Click[]> {
  const { data, error } = await sb.from("events").select("created_at, type, payload").in("type", ["morning.click", "morning.done"])
    .gte("created_at", new Date(now - QUIET_MS).toISOString()).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((r) => {
    const p = r.payload as { source?: unknown; key?: unknown } | null;
    return p && typeof p.source === "string" && typeof p.key === "string" ? [{ source: p.source, key: p.key, at: r.created_at, done: r.type === "morning.done" }] : [];
  });
}

/** GAME DEV: worst open bugs; "recent" when the dev world was saved in the last 2 days (the latest session). */
async function devworld(sb: SupabaseClient, now: number) {
  const { data, error } = await sb.from("game_saves").select("save, updated_at").eq("game", "devworld").maybeSingle();
  if (error) throw new Error(error.message);
  const v = data?.save ? validateDevWorld(data.save) : null;
  return v?.ok ? { bugs: devBacklog(v.world), recent: now - Date.parse(data!.updated_at) < 2 * 86_400_000 } : undefined;
}

/** Goals with a deadline this week (read-only: GET /api/goals would advance them). */
async function deadlines(sb: SupabaseClient, userId: string, today: string) {
  const { data, error } = await sb.from("goals").select("id, doc").eq("user_id", userId).in("status", ["draft", "approved", "running", "waiting", "paused", "blocked"]).limit(30);
  if (error) throw new Error(error.message);
  return goalDeadlines(data ?? [], today);
}

/** The newest ARCH lesson saved in the last 14 days (ArchWorld saves them as notes tagged arch + lesson). */
async function archLesson(sb: SupabaseClient, now: number) {
  const { data, error } = await sb.from("memories").select("id, title").contains("tags", ["arch", "lesson"])
    .gte("created_at", new Date(now - 14 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? undefined;
}

/** Approvals waiting: the list keeps 6 items with approvals first, so a full list of them may hide more. */
const approvals = (w: { items: { status: string }[]; more: number }) => {
  const k = w.items.filter((x) => x.status === "awaiting_approval").length;
  return k === w.items.length ? k + w.more : k;
};

// The morning card and the morning brief both ask on the first open: one gather serves both (since stays per request).
const MEMO_MS = 15_000;
const memo = new Map<string, { at: number; p: Promise<Morning> }>();
export async function getMorning(sb: SupabaseClient, userId: string, now = Date.now(), from: number | null = null): Promise<Morning> {
  let m = memo.get(userId);
  if (!m || Math.abs(now - m.at) > MEMO_MS) {
    const p = gather(sb, userId, now);
    memo.set(userId, (m = { at: now, p }));
    p.catch(() => { if (memo.get(userId)?.p === p) memo.delete(userId); });
  }
  const [base, since] = await Promise.all([m.p, from === null ? undefined : getSince(sb, from, now).catch(() => undefined)]);
  return { ...base, ...(since && { since }) };
}

async function gather(sb: SupabaseClient, userId: string, now: number): Promise<Morning> {
  const tz = (await readPublishSettings().catch(() => null))?.timezone || "Europe/Tallinn";
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone; // LIFE and memory anniversaries use the PC's local days, not the publish timezone
  const today = localDay(new Date(now)); // markets' firedOn is a server-local day; goal deadlines are local days too
  const cardSources = Promise.allSettled([within(thumbs(sb, now)), within(import("./markets").then((x) => x.listAlerts())), within(import("./ideas").then((x) => x.listIdeas())),
    within(clicks(sb, now)), within(devworld(sb, now)), within(deadlines(sb, userId, dayKey(new Date(now), safeZone(tz)))), within(archLesson(sb, now))]);
  const [s, i, a, l, r, sn, c, w, ct, bf] = await Promise.allSettled([within(studio(now, tz)), within(intel(sb)), within(agents(sb, now)),
    within(import("./life").then((m) => m.getLife()).then((st) => lifeSection(st, now, localTz))), within(recall(sb, now, localTz)),
    Promise.resolve(undefined), // since: per request, in getMorning
    // Same cache entry as the LIFE card. No Google client configured → no calendar section at all. A failed read shows as
    // failed (never a silently missing section); a grant Google refused shows as expired, not as "not connected".
    within(Promise.all([import("./gcal"), import("./gcal-pure")]).then(async ([g, p]) => {
      if (!g.calEnv()) return undefined;
      try {
        const ev = await g.calendarEvents(7, now);
        return ev ? { connected: true, today: p.todayEvents(ev, now) } : { connected: false, today: [], ...((await g.calExpired()) && { expired: true }) };
      } catch (e) {
        const f = p.calFailure(e);
        return f.expired ? { connected: false, today: [], expired: true } : { connected: true, today: [], error: f.text };
      }
    })).catch(() => ({ connected: true, today: [], error: "Couldn't reach Google Calendar" })), within(getContinueWork(sb, userId)), within(contactedToday(sb, now, tz)),
    within(Promise.resolve(sb.from("prospects").select("id,name,stage,updated_at,notes").eq("stage", "contacted")).then(({ data, error }) => {
      if (error) throw error;
      return import("./prospect-crm").then((c) => c.withTouch(data ?? [])).then((ps) => dueFollowups(ps, now));
    }))]);
  const invP = within(import("./money").then((x) => x.digestMoney(sb, now))).catch(() => ""); // money-pure moneyLine: same split as BUSINESS → Money
  const ovP = within(Promise.all([import("./business-overview"), import("./business-overview-pure")]).then(async ([x, p]) => p.overviewLine(await x.getOverview(sb, userId, now)))).catch(() => ""); // the BUSINESS overview strip in one line
  const nightP = within(import("./night").then((x) => x.getNightReport(sb, userId, now))).catch(() => null); // a failure just drops the section
  const [th, al, ids, cl, dw, dl, ar] = await cardSources;
  const life = ok(l), rec = ok(r), since = ok(sn) as MorningSince | undefined, work = ok(w), st = ok(s), due = ok(bf);
  const base = dropDone(morningCandidates({ work, studioReady: st?.ready, proposals: ok(a)?.proposals, headlines: ok(i)?.headlines,
    alerts: ok(al)?.filter((x) => x.firedOn === today).map(alertText), followups: due, recall: rec, ideas: ok(ids)?.shown,
    deadlines: ok(dl), dev: ok(dw), archLesson: ok(ar) }), ok(cl) ?? [], now);
  const cands = await import("./lessons").then((m) => m.morningPrior(userId, base), () => base); // kept lessons nudge base ±15% (lessons-pure withPrior)
  const hero = pickHero(cands, ok(th) ?? [], ok(cl) ?? [], now) ?? undefined;
  const cards = rankCards(cands.filter((x) => x.key !== hero?.key), ok(th) ?? [], now);
  // Only counted from loaded sources: a mission ticked from missing data would be a false claim. The default three hide the
  // mission when any of them failed (as before); his own picks show a failed source's item as "no data".
  const picks = await import("./daily-mission").then((d) => d.loadPicks()).catch(() => []);
  const base3 = { shortsToday: st?.today.length, contactedToday: ok(ct), approvalsWaiting: work ? approvals(work) : undefined };
  const mission = picks.length ? dailyMission({ ...base3, ...(await within(import("./daily-mission").then((d) => d.extraCounts(userId, picks, now))).catch(() => ({}))) }, picks)
    : st && work && ok(ct) !== undefined ? dailyMission(base3) : undefined;
  return { ...buildMorning({ studio: ok(s), intel: ok(i), agents: ok(a), life: life && (life.habits || life.next) ? life : undefined, calendar: ok(c), recall: rec?.length ? rec : undefined,
    business: (await ovP) || [due && businessFollowupLine(due.length), await invP].filter(Boolean).join(". ") || undefined, overnight: overnightLine(await readSleepReport(userId).catch(() => undefined), localDay(new Date(now))), work: work ?? { items: [], more: 0, problems: ["Unfinished work could not be loaded."] }, mission }, now, tz), cards,
    deadlines: ok(dl) ?? null, followups: due ? due.map((p) => ({ id: p.id, name: p.name })) : null, // the brief's Today section; null = the source failed, never "nothing due"
    ...(hero && { hero }), ...(since && { since }), ...((await nightP) && { night: (await nightP)! }) };
}
