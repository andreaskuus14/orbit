// "Good morning" briefing (pure, tested in tests/morning.test.ts): turns already-gathered ORBIT data into the card's sections
// and a spoken version built from a template — no AI call, so it's instant and free. Gathering: morning.ts.
import type { Clip } from "./clips/types";
import type { Recall } from "./resurface-pure";
import type { WorkItem, WorkSummary } from "./work-continuation-pure";
import { missionLine, type Mission } from "./daily-mission-pure.ts";
import type { Card, Deadline, Hero } from "./morning-rank-pure";
import type { NightReport } from "./night-pure";

export type MorningNav = "review" | "news" | "tasks" | "agents" | "life" | "goals";
export type StudioIn = {
  clips: Pick<Clip, "title" | "status" | "publish">[]; views: Record<string, number>; // views: videoId → latest views (learn.json)
  pausedUntil: number; scout: { newPicks: number; topNiche?: string; summary?: string } | null; tz: string;
};
export type MorningStudio = { ready: number; approved: number; today: string[]; yesterday: { title: string; views: number | null; videoId?: string }[]; scout: string; pausedUntil: string };
export type MorningIntel = { title: string; at: string; headlines: string[] };
export type MorningAgents = { done: string[]; failed: number; proposals: string[]; verified?: number }; // verified: done with read-back evidence
export type MorningLife = { habits: number; done: number; next: { text: string; at: string } | null }; // next.at = "HH:MM" today
export type MorningCalendar = { connected: boolean; today: { time: string; title: string }[]; expired?: boolean; error?: string }; // titles: calendar data (invites), plain text only
export type Morning = {
  greeting: string; business?: string; studio?: MorningStudio; intel?: MorningIntel; agents?: MorningAgents; life?: MorningLife; calendar?: MorningCalendar; recall?: Recall[]; since?: MorningSince; work?: WorkSummary; mission?: Mission;
  cards?: Card[]; // the ranked morning cards (morning-rank-pure.ts)
  deadlines?: Deadline[] | null; // goals due within a week, overdue ones too (morning-rank-pure goalDeadlines); null = couldn't be read
  followups?: { id: string; name: string }[] | null; // BUSINESS prospects due a follow-up (business-pure dueFollowups); null = couldn't be read
  hero?: Hero; // "Do this first": the single best action, kept out of cards
  overnight?: string; // the sleep loop's report for today (sleep.ts), shown as one line
  night?: NightReport; // "While you slept": last night's night shift (night.ts)
  suggestion: { text: string; nav: MorningNav | null; item?: WorkItem }; spoken: string;
};

export const MAX_WORDS = 110; // ≈ 45 s at a normal speaking pace
const DAY = 86_400_000;
const day = (t: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
const hm = (t: number, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
/** Plain speakable text: no emoji, markdown or citation marks. */
export const plain = (s: string) => s.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/[^\p{L}\p{N}\s.,:;'’"!?%&()/-]/gu, "").replace(/\s+/g, " ").trim();

export function greeting(now: number, tz: string): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now)) % 24;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The story headlines of a Pulse briefing ("### Headline — Confirmed"), first `max`. */
export function pulseHeadlines(content: string, max = 3): string[] {
  return [...content.matchAll(/^###\s+(.+)$/gm)].map((m) => plain(m[1].replace(/\s+[—–-]\s+(?:Confirmed|Single source)\s*$/i, ""))).filter(Boolean).slice(0, max);
}

export function studioSection(x: StudioIn, now: number): MorningStudio {
  const today = day(now, x.tz), yday = day(now - DAY, x.tz);
  const liveAt = (c: StudioIn["clips"][number]) => {
    const p = c.publish;
    const t = Date.parse(p?.scheduledFor ?? (p?.status === "done" ? p.at : ""));
    return p && (p.status === "scheduled" || p.status === "done") && Number.isFinite(t) ? t : NaN;
  };
  const timed = x.clips.map((c) => ({ c, t: liveAt(c) })).filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  const niche = x.scout?.topNiche ? `Top niche: ${x.scout.topNiche}.` : "";
  const picks = x.scout?.newPicks ? `${n(x.scout.newPicks, "new scout pick")}.` : "";
  return {
    ready: x.clips.filter((c) => c.status === "ready").length,
    approved: x.clips.filter((c) => c.status === "approved" && (!c.publish || c.publish.status === "failed")).length,
    today: timed.filter((e) => day(e.t, x.tz) === today).map((e) => hm(e.t, x.tz)),
    yesterday: timed.filter((e) => day(e.t, x.tz) === yday)
      .map(({ c }) => ({ title: plain(c.title), views: c.publish?.videoId && c.publish.videoId in x.views ? x.views[c.publish.videoId] : null,
        ...(c.publish?.videoId && /^[\w-]{11}$/.test(c.publish.videoId) ? { videoId: c.publish.videoId } : {}) })),
    scout: [picks, niche].filter(Boolean).join(" "),
    pausedUntil: x.pausedUntil > now ? hm(x.pausedUntil, x.tz) : "",
  };
}

export function suggest(m: Pick<Morning, "studio" | "intel" | "agents" | "life" | "work">): Morning["suggestion"] {
  const s = m.studio, a = m.agents;
  // Approvals, blockers and waiting plans need a decision; running/paused work doesn't.
  const next = m.work?.items.find((x) => ["awaiting_approval", "draft", "waiting", "blocked", "failed"].includes(x.status));
  if (next) return { text: `${next.action}: ${plain(next.title).split(/\s+/).slice(0, 12).join(" ")}.`, nav: next.kind === "goal" ? "goals" : "tasks", item: next };
  if (s?.ready) return { text: `Review your ${n(s.ready, "new clip")}.`, nav: "review" };
  if (a?.proposals.length) return { text: `Approve or dismiss ${n(a.proposals.length, "agent proposal")}.`, nav: "agents" };
  if (s?.approved && !s.today.length) return { text: `Schedule your ${n(s.approved, "approved clip")}, nothing goes live today.`, nav: "review" };
  if (a?.failed) return { text: `Check the ${n(a.failed, "task")} that failed overnight.`, nav: "tasks" };
  if (m.life && m.life.habits > m.life.done) return { text: `Do your ${n(m.life.habits - m.life.done, "habit")} for today.`, nav: "life" };
  if (m.intel?.headlines.length) return { text: "Read today's news briefing.", nav: "news" };
  return { text: "Drop a video in the inbox or give your agents a task.", nav: null };
}

/** The spoken briefing: plain sentences, at most MAX_WORDS (optional sentences are dropped from the end first). */
export function spokenBriefing(m: Omit<Morning, "spoken">): string {
  const s = m.studio, a = m.agents, i = m.intel;
  const must = [`${m.greeting}.`], opt: string[] = [];
  if (m.business) opt.push(`${m.business}.`);
  if (m.mission) opt.unshift(missionLine(m.mission)); // first of the optional lines: dropped last, never past the word cap
  if (m.work?.items.length) opt.push(`Your work list shows ${n(m.work.items.length + m.work.more, "unfinished item")}.`);
  if (m.work?.problems.length) opt.push("Some unfinished work could not be loaded.");
  if (s) {
    must.push(s.ready ? `You have ${n(s.ready, "clip")} ready to review.` : "No clips are waiting for review.");
    if (s.today.length) must.push(`${n(s.today.length, "Short")} ${s.today.length === 1 ? "goes" : "go"} live today at ${s.today.slice(0, 4).join(", ")}.`);
    if (s.yesterday.length) {
      const top = [...s.yesterday].sort((x, y) => (y.views ?? -1) - (x.views ?? -1))[0];
      opt.push(`Yesterday ${n(s.yesterday.length, "Short")} went live${top.views !== null ? `; the best, ${top.title}, has ${top.views.toLocaleString("en-US")} views so far` : ""}.`);
    }
    if (s.pausedUntil) opt.push(`YouTube downloads are paused until ${s.pausedUntil}.`);
    if (s.scout) opt.push(s.scout);
  }
  if (a) {
    if (a.proposals.length) must.push(`${n(a.proposals.length, "agent proposal")} ${a.proposals.length === 1 ? "is" : "are"} waiting for approval.`);
    if (a.done.length) opt.push(`Overnight your agents finished ${n(a.done.length, "task")}${a.verified !== undefined ? ` (${a.verified} verified)` : ""}${a.failed ? ` and ${a.failed} failed` : ""}.`);
    else if (a.failed) opt.push(`${n(a.failed, "agent task")} failed overnight.`);
  }
  const ev = m.calendar?.today ?? [];
  if (m.calendar?.expired) must.push("Google Calendar sign-in expired, so I couldn't check today's events. Reconnect it in LIFE.");
  else if (m.calendar?.error) must.push("I couldn't read your calendar this morning, so today's events are missing.");
  if (ev.length) must.push(`${n(ev.length, "event")} on your calendar today, first ${/^\d/.test(ev[0].time) ? `at ${ev[0].time}` : ev[0].time}: ${plain(ev[0].title)}.`);
  const l = m.life;
  if (l?.next) must.push(`Reminder at ${l.next.at}: ${l.next.text}.`);
  if (l?.habits) opt.push(l.done >= l.habits ? `All ${n(l.habits, "habit")} done for today.` : `${n(l.habits - l.done, "habit")} to do today.`);
  if (i?.headlines.length) opt.push(`In the news: ${i.headlines.slice(0, 2).join(". ")}.`);
  const said = m.recall?.length ? plain(m.recall[0].title) : ""; // an emoji-only title says nothing: skip it
  if (said) opt.push(`From your memory, ${m.recall![0].label}: ${said}.`); // last, so dropped first
  const tail = `My suggestion: ${m.suggestion.text}`;
  const words = (xs: string[]) => xs.join(" ").split(/\s+/).length;
  while (opt.length && words([...must, ...opt, tail]) > MAX_WORDS) opt.pop();
  return plain([...must, ...opt, tail].join(" ").replace(/\.\./g, "."));
}

/** "Overnight: …" when the sleep loop left a non-empty report for this local day. */
export const overnightLine = (r: { day: string; line: string } | undefined, today: string) =>
  r && r.day === today && r.line.trim() ? `Overnight: ${plain(r.line)}.` : undefined;

export function buildMorning(parts: Pick<Morning, "studio" | "intel" | "agents" | "life" | "calendar" | "recall" | "work" | "mission" | "business" | "overnight">, now: number, tz: string): Morning {
  const base = { ...parts, greeting: greeting(now, tz), suggestion: suggest(parts) };
  return { ...base, spoken: spokenBriefing(base) };
}

/** Auto-show once per local day, from 05:00 on. lastDay: the stored "YYYY-MM-DD" it was last shown. */
export const localDay = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
export const shouldAutoShow = (lastDay: string | null, now: Date) => now.getHours() >= 5 && lastDay !== localDay(now);

/** LIFE for the briefing: today's scheduled habits and the next reminder still due today (local server time). */
export function lifeSection(x: { habits: { scheduledToday: boolean; doneToday: boolean }[]; reminders: { text: string; at: string; fired?: string }[] }, now: number, tz: string): MorningLife {
  const today = x.habits.filter((h) => h.scheduledToday);
  const next = x.reminders.filter((r) => !r.fired && Date.parse(r.at) > now && day(Date.parse(r.at), tz) === day(now, tz))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  return { habits: today.length, done: today.filter((h) => h.doneToday).length, next: next ? { text: plain(next.text), at: hm(Date.parse(next.at), tz) } : null };
}

/* ---------- "Since you left" recap: shown on return after RECAP_AWAY_MS away, or merged into the morning card ---------- */
export const RECAP_AWAY_MS = 3 * 3_600_000;
export const RECAP_MAX_MS = 7 * DAY; // older last-seen values are clamped: a recap of "everything since March" isn't a recap
// live: Shorts that went live in the window. approvals: waiting now (state, not a change, so it never opens a recap alone).
export type MorningSince = { from: number; done: number; failed: number; clips: number; reminders: string[]; alerts: string[]; live?: number; approvals?: number };

/** The start of the away window, or null when the user wasn't away long enough (or lastSeen is missing/in the future). */
export function awaySince(lastSeen: number | null, now: number): number | null {
  if (lastSeen === null || !Number.isFinite(lastSeen) || lastSeen > now || now - lastSeen < RECAP_AWAY_MS) return null;
  return Math.max(lastSeen, now - RECAP_MAX_MS);
}

/** The ?since= query value (ms epoch) validated and clamped; null when absent or nonsense. */
export function parseSince(raw: string | null, now: number): number | null {
  const t = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(t) && t < now ? Math.max(t, now - RECAP_MAX_MS) : null;
}

/** What happened in [from, now]. Server-local days for alerts (markets' firedOn is a server-local "YYYY-MM-DD"). */
export function sinceSection(x: {
  tasks: { status: string }[]; // root tasks already filtered to finished_at ≥ from
  jobs: { updatedAt: string; clips: { status: string; publish?: { status?: string; at?: string; scheduledFor?: string } }[] }[];
  reminders: { text: string; at: string; fired?: string }[];
  alerts: { text: string; firedOn?: string }[];
  approvals?: number;
}, from: number, now: number): MorningSince {
  const inWin = (t: number) => t >= from && t <= now;
  const fromDay = localDay(new Date(from));
  return {
    from,
    done: x.tasks.filter((t) => t.status === "done").length,
    failed: x.tasks.filter((t) => t.status === "failed").length,
    // shortcut: clips have no own timestamp, so a ready clip counts when its job changed in the window; add Clip.readyAt if this overcounts.
    clips: x.jobs.filter((j) => inWin(Date.parse(j.updatedAt))).reduce((k, j) => k + j.clips.filter((c) => c.status === "ready").length, 0),
    // A one-off came due while away whether or not a window showed it yet. shortcut: recurring ones move `at` forward and are missed.
    reminders: x.reminders.filter((r) => inWin(Date.parse(r.fired ?? r.at))).map((r) => plain(r.text)).slice(0, 3),
    alerts: x.alerts.filter((a) => a.firedOn && a.firedOn >= fromDay && a.firedOn <= localDay(new Date(now))).map((a) => a.text).slice(0, 3),
    // Uploaded now, or scheduled for a time that has passed (YouTube made it public then).
    live: x.jobs.flatMap((j) => j.clips).filter((c) => { const p = c.publish, t = Date.parse(p?.scheduledFor ?? (p?.status === "done" ? p.at ?? "" : ""));
      return (p?.status === "done" || p?.status === "scheduled") && inWin(t); }).length,
    approvals: x.approvals ?? 0,
  };
}

/** Client-side counts from the bell's history (localStorage). */
export const countSince = (items: { at: number }[], from: number) => items.filter((i) => i.at >= from).length;
export const sinceEmpty = (s: MorningSince, notes: number) => !s.done && !s.failed && !s.clips && !s.live && !s.reminders.length && !s.alerts.length && !notes;

/** JARVIS-style spoken recap on return: only what changed, then what's waiting on you. "" when nothing happened. */
export function sinceSpoken(s: MorningSince, notes: number): string {
  if (sinceEmpty(s, notes)) return "";
  const bits = [
    s.live && `${n(s.live, "Short")} went live`,
    s.clips && `${n(s.clips, "new clip")} ${s.clips === 1 ? "is" : "are"} ready to review`,
    s.done && `${n(s.done, "agent task")} finished`,
    s.failed && `${s.failed} failed`,
    s.reminders.length && `${n(s.reminders.length, "reminder")} came due`,
    s.alerts.length && `${n(s.alerts.length, "market alert")} fired`,
  ].filter(Boolean) as string[];
  const list = bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}` : bits[0] ?? `${n(notes, "new notification")}`;
  const wait = s.approvals ? ` ${n(s.approvals, "approval")} ${s.approvals === 1 ? "is" : "are"} waiting for you.` : "";
  return plain(`Welcome back. While you were away, ${list}.${wait}`);
}

/** Shared card and spoken line; zero is shown when the source loaded. */
export const businessFollowupLine = (count: number) => `${count} businesses need a follow-up`;
