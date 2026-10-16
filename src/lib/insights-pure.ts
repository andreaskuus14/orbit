// CORE's proactive insights (pure, tested in tests/insights.test.ts): cheap rules over STUDIO's local state turn noteworthy
// situations into suggestions with one-click actions. No AI calls. Server glue: src/lib/insights.ts; state: <studio>/insights.json.
import type { NavTarget } from "./nav-pure";

/** One click: POSTs to our own STUDIO routes in order (same validation as the UI buttons), or a fly-to. */
export type InsightAction = { label: string; post?: { url: string; body?: Record<string, unknown> }[]; nav?: NavTarget };
export type Suggestion = {
  key: string; kind: "hot" | "upload" | "ready" | "approved" | "tomorrow" | "doctor"; priority: "high" | "normal";
  title: string; detail: string; actions: InsightAction[]; createdAt: number; expiresAt: number;
  dismissed?: boolean; snoozeUntil?: number;
};
export type InsightState = { v: 1; at: number; items: Suggestion[] };
export const emptyInsights = (): InsightState => ({ v: 1, at: 0, items: [] });

type ClipLike = { id: string; title: string; status: string; score?: number; variantOf?: string; publish?: { status: string; scheduledFor?: string; videoId?: string } };
type Snap = { views: number };
export type InsightInput = {
  now: number; tz: string;
  jobs: { id: string; source: string; status: string; createdAt: string; updatedAt: string; clips: ClipLike[] }[];
  downloads: { status: string; error?: string; createdAt: string }[];
  ytPausedUntil: number;
  learn: { videoId: string; jobId: string; clipId: string; title: string; sourceChannel: string; publishedAt?: string; snaps: { "24h"?: Snap; "72h"?: Snap } }[];
  picks: { videoId: string; title: string; channel: string; source: string; status: string }[];
};

const H = 3_600_000, DAY = 24 * H;
export const RUN_EVERY_MS = 15 * 60_000;
export const HOT_RATIO = 2, MIN_SAMPLE = 3, READY_WAIT_MS = 12 * H, MAX_ITEMS = 50;
const JOB_ID = /^[a-z0-9]{6,12}-[a-f0-9]{6}$/, CLIP_ID = /^clip-\d{1,2}(-v\d{1,2})?$/;
const BLOCKED = /not a bot|blocked the download/i;

// Titles and names come from YouTube / file names: keep them short and inert (they also reach CORE's prompt).
const clean = (s: string, max = 60) => s.replace(/[<>\r\n`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const dayIn = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

const SCHEDULE: InsightAction = { label: "Schedule them", post: [{ url: "/api/studio/clips/schedule" }] };
const REVIEW: InsightAction = { label: "Review now", nav: { panel: "studio", view: "review" } };
const DOCTOR: InsightAction = { label: "Open doctor", nav: { panel: null, doctor: true } };
const SCOUT: InsightAction = { label: "Run the scout", post: [{ url: "/api/studio/clips/scout" }] };

type Draft = Omit<Suggestion, "createdAt" | "dismissed" | "snoozeUntil">;

/** Every noteworthy situation right now. Keys are stable per situation (recurring states carry the day, so a dismissal lasts a day). */
export function detect(x: InsightInput): Draft[] {
  const out: Draft[] = [], { now, tz } = x, today = dayIn(now, tz);
  const clips = x.jobs.flatMap((j) => j.clips.map((c) => ({ j, c })));

  // 1. A published Short at ≥2× the channel median for the same age (24 h or 72 h snapshot).
  for (const k of ["72h", "24h"] as const) {
    const have = x.learn.filter((r) => r.snaps[k]);
    if (have.length < MIN_SAMPLE) continue;
    const med = median(have.map((r) => r.snaps[k]!.views)) || 1;
    for (const r of have) {
      const ratio = r.snaps[k]!.views / med, key = `hot:${r.videoId}`;
      if (ratio < HOT_RATIO || out.some((o) => o.key === key) || !(now - Date.parse(r.publishedAt ?? "") < 8 * DAY)) continue;
      const actions: InsightAction[] = [];
      const c = x.jobs.find((j) => j.id === r.jobId)?.clips.find((c) => c.id === r.clipId);
      if (c && JOB_ID.test(r.jobId) && CLIP_ID.test(r.clipId) && (c.status === "ready" || c.status === "approved")) {
        const url = `/api/studio/clips/${r.jobId}/${r.clipId}/version`;
        actions.push({ label: "Make 2 more versions of this moment", post: [{ url, body: { suggest: true } }, { url, body: { suggest: true, captions: "classic" } }] });
      }
      const who = clean(r.sourceChannel, 40);
      if (who && who !== "unknown") actions.push({ label: "Find more clips from this creator", post: [{ url: "/api/studio/clips/scout/creators", body: { input: who } }, SCOUT.post![0]] });
      if (!actions.length) continue;
      out.push({ key, kind: "hot", priority: "high", title: `"${clean(r.title)}" is at ${Math.round(ratio * 10) / 10}× your usual views (${k})`,
        detail: `${r.snaps[k]!.views.toLocaleString("en-US")} views vs a median of ${Math.round(med).toLocaleString("en-US")}.`, actions, expiresAt: now + 3 * DAY });
    }
  }

  // 2. A watched creator's new long video the scout found and nobody has clipped.
  for (const p of x.picks) {
    if (p.source !== "watchlist" || p.status !== "new" || !/^[\w-]{11}$/.test(p.videoId)) continue;
    out.push({ key: `upload:${p.videoId}`, kind: "upload", priority: "normal", title: `${clean(p.channel, 40)} uploaded "${clean(p.title)}"`,
      detail: "New long video from your watchlist, not clipped yet.", actions: [{ label: "Clip it now", post: [{ url: "/api/studio/clips/scout/picks", body: { videoId: p.videoId, action: "clip" } }] }],
      expiresAt: now + 2 * DAY });
  }

  // 3. Ready clips waiting > 12 h. shortcut: clips carry no ready-time, the job's start stands in (rendering takes minutes, not hours).
  const ready = clips.filter(({ j, c }) => c.status === "ready" && now - Date.parse(j.createdAt) > READY_WAIT_MS).length;
  if (ready) out.push({ key: `ready:${today}`, kind: "ready", priority: "normal", title: `${n(ready, "clip")} waiting for review over 12 h`,
    detail: "Fresh moments age fast; approve or reject them.", actions: [REVIEW], expiresAt: now + DAY });

  // 4./5. Approved clips with no schedule; tomorrow's publish slots empty.
  const approved = clips.filter(({ c }) => c.status === "approved" && (!c.publish || c.publish.status === "failed")).length;
  const tomorrow = dayIn(now + DAY, tz);
  const tomorrowSet = clips.some(({ c }) => c.publish?.scheduledFor && ["scheduled", "uploading", "unknown"].includes(c.publish.status) && dayIn(Date.parse(c.publish.scheduledFor), tz) === tomorrow);
  const everPublished = clips.some(({ c }) => c.publish && c.publish.status !== "failed");
  if (approved) out.push({ key: `approved:${today}`, kind: "approved", priority: "normal", title: `${n(approved, "approved clip")} not scheduled`,
    detail: tomorrowSet ? "They'll go into the next free slots." : "Tomorrow's slots are still empty.", actions: [SCHEDULE], expiresAt: now + DAY });
  else if (everPublished && !tomorrowSet) {
    const readyAny = clips.some(({ c }) => c.status === "ready");
    out.push({ key: `tomorrow:${tomorrow}`, kind: "tomorrow", priority: "normal", title: "Tomorrow has no Shorts scheduled",
      detail: readyAny ? "Review clips, approve a few, then schedule them." : "Nothing is waiting either: find new videos to clip.",
      actions: [{ ...(readyAny ? REVIEW : SCOUT), label: "Fill tomorrow's slots" }], expiresAt: now + DAY });
  }

  // 6. YouTube download pause, or repeated failures in the last day.
  if (x.ytPausedUntil > now) out.push({ key: `ytpause:${x.ytPausedUntil}`, kind: "doctor", priority: "high", title: "YouTube downloads are paused (bot check)",
    detail: "Downloads resume on their own; the doctor shows how to fix it for good.", actions: [DOCTOR], expiresAt: x.ytPausedUntil });
  const failed = x.jobs.filter((j) => j.status === "failed" && now - Date.parse(j.updatedAt) < DAY).length
    + x.downloads.filter((d) => d.status === "failed" && !BLOCKED.test(d.error ?? "") && now - Date.parse(d.createdAt) < DAY).length;
  if (failed >= 2) out.push({ key: `failures:${today}`, kind: "doctor", priority: "high", title: `${n(failed, "job")} failed in the last day`,
    detail: "Something may be broken (tools, disk, network).", actions: [DOCTOR], expiresAt: now + DAY });
  return out;
}

/** New detections into the stored list: keep dismiss/snooze per key, drop resolved (unless dismissed or snoozed, so a flicker can't re-show it) and expired. */
export function merge(s: InsightState, found: Draft[], now: number): InsightState {
  const old = new Map(s.items.map((i) => [i.key, i]));
  const items: Suggestion[] = found.map((f) => { const o = old.get(f.key); return { ...f, createdAt: o?.createdAt ?? now, dismissed: o?.dismissed, snoozeUntil: o?.snoozeUntil }; });
  for (const o of s.items) if ((o.dismissed || (o.snoozeUntil ?? 0) > now) && !items.some((i) => i.key === o.key)) items.push(o);
  return { v: 1, at: now, items: items.filter((i) => i.expiresAt > now).slice(0, MAX_ITEMS) };
}

/** What to show: not dismissed, not snoozed, not expired; high priority first, then newest. */
export const visible = (s: InsightState, now: number) =>
  s.items.filter((i) => !i.dismissed && !(i.snoozeUntil && i.snoozeUntil > now) && i.expiresAt > now)
    .sort((a, b) => (a.priority === b.priority ? b.createdAt - a.createdAt : a.priority === "high" ? -1 : 1));

/** dismiss / done (hidden until it expires) or snooze (hidden for hours). Returns false for an unknown key. */
export function act(s: InsightState, key: string, op: "dismiss" | "done" | "snooze", now: number, hours = 4): boolean {
  const i = s.items.find((x) => x.key === key);
  if (!i) return false;
  if (op === "snooze") i.snoozeUntil = now + Math.min(72, Math.max(1, hours)) * H;
  else i.dismissed = true;
  return true;
}

/** "" when insights.json is usable (readState's contract). */
export function insightsProblem(x: unknown): string {
  const s = x as InsightState;
  if (!s || s.v !== 1 || typeof s.at !== "number" || !Array.isArray(s.items)) return "not an insights state";
  return s.items.every((i) => i && typeof i.key === "string" && typeof i.title === "string" && Array.isArray(i.actions) && typeof i.expiresAt === "number") ? "" : "bad item";
}

/** "Anything I should do?" and friends: CORE then sees the top suggestion. */
export const asksWhatToDo = (q: string) => /\b(anything|what)\b.{0,20}\b(should|could|need to|to)\s+(i|we)\s+do\b|\b(anything|something)\s+(i|we)\s+(should|need to|have to|must)\s+do\b|\bwhat('?s| is)\s+next\b|\bany\s+(suggestions?|ideas|tips)\b|\bwhat needs (my )?attention\b|\bwhat should i (do|focus on|work on)\b/i.test(q);

/** Suggestions as short lines for CORE (data, not instructions). */
export const formatSuggestions = (xs: Suggestion[]) =>
  xs.length ? xs.map((s) => `- ${s.title}. ${s.detail} (one-click in CORE: ${s.actions.map((a) => a.label).join(" / ")})`).join("\n") : "No suggestions right now; everything looks on track.";
