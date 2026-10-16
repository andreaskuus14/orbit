// "Good morning" briefing (pure, tested in tests/morning.test.ts): turns already-gathered ORBIT data into the card's sections
// and a spoken version built from a template — no AI call, so it's instant and free. Gathering: morning.ts.
import type { Clip } from "./clips/types";

export type MorningNav = "review" | "news" | "tasks" | "agents";
export type StudioIn = {
  clips: Pick<Clip, "title" | "status" | "publish">[]; views: Record<string, number>; // views: videoId → latest views (learn.json)
  pausedUntil: number; scout: { newPicks: number; topNiche?: string; summary?: string } | null; tz: string;
};
export type MorningStudio = { ready: number; approved: number; today: string[]; yesterday: { title: string; views: number | null }[]; scout: string; pausedUntil: string };
export type MorningIntel = { title: string; at: string; headlines: string[] };
export type MorningAgents = { done: string[]; failed: number; proposals: string[] };
export type Morning = {
  greeting: string; studio?: MorningStudio; intel?: MorningIntel; agents?: MorningAgents;
  suggestion: { text: string; nav: MorningNav | null }; spoken: string;
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
      .map(({ c }) => ({ title: plain(c.title), views: c.publish?.videoId && c.publish.videoId in x.views ? x.views[c.publish.videoId] : null })),
    scout: [picks, niche].filter(Boolean).join(" "),
    pausedUntil: x.pausedUntil > now ? hm(x.pausedUntil, x.tz) : "",
  };
}

export function suggest(m: Pick<Morning, "studio" | "intel" | "agents">): Morning["suggestion"] {
  const s = m.studio, a = m.agents;
  if (s?.ready) return { text: `Review your ${n(s.ready, "new clip")}.`, nav: "review" };
  if (a?.proposals.length) return { text: `Approve or dismiss ${n(a.proposals.length, "agent proposal")}.`, nav: "agents" };
  if (s?.approved && !s.today.length) return { text: `Schedule your ${n(s.approved, "approved clip")}, nothing goes live today.`, nav: "review" };
  if (a?.failed) return { text: `Check the ${n(a.failed, "task")} that failed overnight.`, nav: "tasks" };
  if (m.intel?.headlines.length) return { text: "Read today's news briefing.", nav: "news" };
  return { text: "Drop a video in the inbox or give your agents a task.", nav: null };
}

/** The spoken briefing: plain sentences, at most MAX_WORDS (optional sentences are dropped from the end first). */
export function spokenBriefing(m: Omit<Morning, "spoken">): string {
  const s = m.studio, a = m.agents, i = m.intel;
  const must = [`${m.greeting}.`], opt: string[] = [];
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
    if (a.done.length) opt.push(`Overnight your agents finished ${n(a.done.length, "task")}${a.failed ? ` and ${a.failed} failed` : ""}.`);
    else if (a.failed) opt.push(`${n(a.failed, "agent task")} failed overnight.`);
  }
  if (i?.headlines.length) opt.push(`In the news: ${i.headlines.slice(0, 2).join(". ")}.`);
  const tail = `My suggestion: ${m.suggestion.text}`;
  const words = (xs: string[]) => xs.join(" ").split(/\s+/).length;
  while (opt.length && words([...must, ...opt, tail]) > MAX_WORDS) opt.pop();
  return plain([...must, ...opt, tail].join(" ").replace(/\.\./g, "."));
}

export function buildMorning(parts: Pick<Morning, "studio" | "intel" | "agents">, now: number, tz: string): Morning {
  const base = { ...parts, greeting: greeting(now, tz), suggestion: suggest(parts) };
  return { ...base, spoken: spokenBriefing(base) };
}

/** Auto-show once per local day, from 05:00 on. lastDay: the stored "YYYY-MM-DD" it was last shown. */
export const localDay = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
export const shouldAutoShow = (lastDay: string | null, now: Date) => now.getHours() >= 5 && lastDay !== localDay(now);
