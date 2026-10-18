// Herald: ORBIT's animated pop-up cards (uploads, trends, briefings, breaking news). Pure rules, tested in tests/herald.test.ts.
// UI + polling: src/components/Herald.tsx. Never speaks, never plays sound, never takes focus.
import type { NavTarget } from "./nav-pure.ts";
import { localDay } from "./morning-pure.ts";

export type HeraldKind = "upload" | "trend" | "brief" | "breaking" | "studio" | "agents";
/** nav: fly there. clip: also prefill STUDIO's "Add from link" box with this URL (never starts a job). */
export type HeraldAction = { label: string; nav: NavTarget; clip?: string };
export type HeraldCard = { key: string; kind: HeraldKind; title: string; body?: string; actions: HeraldAction[] };
/** seen: key → when shown (pruned after 7 days); shown: recent show times (rate limit); snooze: quiet until; mute: off until unmuted. */
export type HeraldState = { seen: Record<string, number>; shown: number[]; snooze: number; mute: boolean };

export const HERALD_KEY = "orbit.herald";
export const CLIP_PREFILL_KEY = "orbit.clipPrefill"; // sessionStorage: URL for ClipFactory's link box, taken once
export const CLIP_PREFILL_EVENT = "orbit:clip-prefill"; // detail: url; for a link box that is already on screen
export const MAX_PER_HOUR = 4;
export const MAX_ON_SCREEN = 3;
const HOUR = 3_600_000, WEEK = 7 * 24 * HOUR, QUEUE_CAP = 12;
export const KIND_ICON: Record<HeraldKind, string> = { upload: "📤", trend: "🔺", brief: "📰", breaking: "⚡", studio: "🎬", agents: "🤖" };

/** localStorage text → state, with old seen keys and shows outside the hour dropped. Garbage = fresh state. */
export function parseHerald(raw: string | null, now: number): HeraldState {
  let o: Partial<HeraldState> | null = null;
  try { o = JSON.parse(raw ?? "null"); } catch { /* fresh */ }
  const seen: Record<string, number> = {};
  if (o && typeof o.seen === "object" && o.seen) for (const [k, t] of Object.entries(o.seen)) if (typeof t === "number" && now - t < WEEK) seen[k] = t;
  return {
    seen,
    shown: Array.isArray(o?.shown) ? o.shown.filter((t): t is number => typeof t === "number" && now - t < HOUR) : [],
    snooze: typeof o?.snooze === "number" && o.snooze > now ? o.snooze : 0,
    mute: o?.mute === true,
  };
}

/** Which queued cards to show now. Hidden tab, mute or snooze: nothing (the queue waits). Seen keys drop out; at most
 *  MAX_PER_HOUR shows per hour and `room` per call. Returns the new state, the cards to show and what stays queued. */
export function pickDue(state: HeraldState, queue: HeraldCard[], now: number, visible: boolean, room = MAX_ON_SCREEN): { state: HeraldState; show: HeraldCard[]; queue: HeraldCard[] } {
  const keys = new Set<string>();
  const fresh = queue.filter((c) => !state.seen[c.key] && !keys.has(c.key) && keys.add(c.key)).slice(-QUEUE_CAP);
  if (!visible || state.mute || state.snooze > now) return { state, show: [], queue: fresh };
  const shown = state.shown.filter((t) => now - t < HOUR);
  const n = Math.max(0, Math.min(room, MAX_PER_HOUR - shown.length));
  const show = fresh.slice(0, n);
  const seen = { ...state.seen };
  for (const c of show) seen[c.key] = now;
  return { state: { ...state, seen, shown: [...shown, ...show.map(() => now)] }, show, queue: fresh.slice(n) };
}

// ---------- sources ----------

type ClipsLike = { jobs?: { clips?: { publish?: { status: string; at?: string; scheduledFor?: string } }[] }[] };
const REVIEW: NavTarget = { panel: "studio", view: "review" };

/** After noon, if nothing went (or is scheduled to go) live today: a nudge, louder when a daily streak is at risk.
 *  Silent for someone who has never published from ORBIT. */
export function uploadNudge(data: ClipsLike, now: number): HeraldCard | null {
  const today = localDay(new Date(now)), days = new Set<string>();
  for (const j of data.jobs ?? []) for (const c of j.clips ?? []) {
    const p = c.publish;
    if (!p || (p.status !== "done" && p.status !== "scheduled")) continue;
    const t = Date.parse(p.scheduledFor ?? p.at ?? "");
    if (!Number.isNaN(t)) days.add(localDay(new Date(t))); // scheduled later today still covers today
  }
  if (!days.size || days.has(today) || new Date(now).getHours() < 12) return null;
  let streak = 0;
  for (let d = new Date(now); ; streak++) { d.setDate(d.getDate() - 1); if (!days.has(localDay(d))) break; }
  const card = (title: string, body: string): HeraldCard => ({ key: `upload:${today}`, kind: "upload", title, body, actions: [{ label: "Open REVIEW", nav: REVIEW }] });
  return streak >= 2
    ? card(`Day ${streak + 1} streak at risk`, `${streak} days in a row so far. Nothing uploaded or scheduled today yet.`)
    : card("You haven't uploaded today", "Nothing is published or scheduled for today. Pick a clip from REVIEW.");
}

type TrendsLike = {
  risers?: { universeId: number; name: string; growthPct: number; window: string; strong: boolean }[];
  yt?: { risers?: { id: string; title: string; channel: string; strong: boolean }[] };
};
/** Strong risers only: YouTube ones can be clipped, Roblox ones open the radar. */
export function trendCards(t: TrendsLike): HeraldCard[] {
  const out: HeraldCard[] = [];
  for (const r of t.yt?.risers ?? []) if (r.strong && /^[\w-]{6,20}$/.test(r.id)) out.push({
    key: `trend:yt:${r.id}`, kind: "trend", title: `Going viral: ${r.title.slice(0, 80)}`, body: `${r.channel} · rising fast on YouTube`,
    actions: [{ label: "Clip it", nav: { panel: "studio", view: "clips" }, clip: `https://www.youtube.com/watch?v=${r.id}` }],
  });
  for (const r of t.risers ?? []) if (r.strong) out.push({
    key: `trend:rbx:${r.universeId}`, kind: "trend", title: `${r.name.slice(0, 60)} is rising`, body: `+${r.growthPct}% players in ~${r.window} on Roblox`,
    actions: [{ label: "Open radar", nav: { panel: "creation" } }],
  });
  return out;
}

/** The newest briefing, if it was written in the last 2 hours. */
export function briefCard(briefings: { id: string; title?: string | null; created_at: string }[] | undefined, now: number): HeraldCard | null {
  const b = briefings?.[0];
  if (!b || !(now - Date.parse(b.created_at) < 2 * HOUR)) return null;
  return { key: `brief:${b.id}`, kind: "brief", title: "New briefing ready", body: (b.title ?? "").slice(0, 120) || undefined, actions: [{ label: "Read", nav: { panel: "intelligence" } }] };
}

/** Once a day after 05:00, unless the "Good morning" card already showed itself today (morningDay = its saved day). */
export function morningCard(morningDay: string | null, now: number): HeraldCard | null {
  const d = new Date(now), day = localDay(d);
  if (d.getHours() < 5 || morningDay === day) return null;
  return { key: `morning:${day}`, kind: "brief", title: "Your morning brief is ready", body: "Clips, news, agents and your day in one card.", actions: [{ label: "Read", nav: { panel: null, morning: true } }] };
}

const STOP = new Set("with from that this after over into says said will have more about their they than what when where which while amid news live update updates report reports could would been were just year years today week latest video watch first under against".split(" "));
const words = (t: string) => new Set((t.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

type Article = { title: string; url: string; source: string | null; published_at: string | null };
/** Breaking = the same story (titles sharing ≥3 significant words, or ≥2 and half their words) from ≥3 distinct sources
 *  in the last hour. Keyed by the story's earliest article, so it shows once even as more outlets pick it up. */
export function breakingCards(articles: Article[] | undefined, now: number, minSources = 3): HeraldCard[] {
  const recent = (articles ?? []).map((a) => ({ a, t: Date.parse(a.published_at ?? ""), w: words(a.title) }))
    .filter((x) => now - x.t <= HOUR && x.t - now < 10 * 60_000 && x.w.size >= 2).sort((x, y) => x.t - y.t);
  const groups: { seed: (typeof recent)[number]; sources: Set<string> }[] = [];
  for (const x of recent) {
    const g = groups.find(({ seed }) => {
      const shared = [...x.w].filter((w) => seed.w.has(w)).length;
      return shared >= 3 || (shared >= 2 && shared * 2 >= Math.min(x.w.size, seed.w.size));
    });
    const src = (x.a.source || host(x.a.url)).toLowerCase().trim();
    if (g) g.sources.add(src); else groups.push({ seed: x, sources: new Set([src]) });
  }
  return groups.filter((g) => g.sources.size >= minSources).map((g) => ({
    key: `breaking:${g.seed.a.url}`, kind: "breaking", title: `Breaking: ${g.seed.a.title.slice(0, 100)}`, body: `${g.sources.size} sources in the last hour`,
    actions: [{ label: "Open globe", nav: { panel: "intelligence" } }],
  }));
}

/** A bell notice (notify()) of kind studio/agents as a card; other kinds stay bell-only. */
export function fromNotify(d: { title?: unknown; body?: unknown; kind?: unknown; nav?: NavTarget }): HeraldCard | null {
  if ((d.kind !== "studio" && d.kind !== "agents") || typeof d.title !== "string" || !d.title) return null;
  const body = typeof d.body === "string" ? d.body.slice(0, 200) : undefined;
  return { key: `n:${d.title.slice(0, 200)}|${body ?? ""}`, kind: d.kind, title: d.title.slice(0, 120), body, actions: d.nav ? [{ label: "Open", nav: d.nav }] : [] };
}
