// STUDIO week calendar: buckets published / scheduled clips and the free publish slots into 7 local days (today + 6) in the
// owner's publish time zone. Pure (tested); free slots come from nextSlots, so they are exactly what "Schedule all" would fill.
import { dayKey, nextSlots, usedSlots, wall, type PublishSettings } from "./schedule.ts";

// due: its scheduled time passed but nothing confirmed it went public (planned and confirmed stay separate, STU07).
export type CalStatus = "scheduled" | "due" | "published" | "failed" | "pending";
type Pub = { status: string; scheduledFor?: string; startedAt?: string; at?: string; error?: string; videoId?: string };
type CalClip = { id: string; title: string; thumb?: string; publish?: Pub };
export type CalItem = { job: string; clip: string; title: string; thumb?: string; at: number; status: CalStatus; error?: string };
export type CalDay = { key: string; y: number; m: number; d: number; items: CalItem[]; free: number[] };

/** When a clip goes / went live and how to show it, or null if it has no publish time. */
function itemOf(p: Pub, now: number, live: Set<string>): { at: number; status: CalStatus } | null {
  const at = Date.parse((p.status === "done" ? p.scheduledFor ?? p.startedAt ?? p.at : p.scheduledFor ?? (p.status === "failed" ? p.at : undefined)) ?? "");
  if (!Number.isFinite(at)) return null;
  const status: CalStatus = p.status === "done" ? "published"
    : p.status === "scheduled" ? (at > now ? "scheduled" : p.videoId && live.has(p.videoId) ? "published" : "due") : p.status === "failed" ? "failed" : "pending"; // uploading / unknown
  return { at, status };
}

/** live: video ids seen public with views after their time (learn.json readings), the only thing that confirms a scheduled Short. */
export function weekCalendar(jobs: { id: string; clips: CalClip[] }[], s: PublishSettings, now: number, days = 7, live = new Set<string>()): CalDay[] {
  const [y, m, d] = wall(now, s.timezone);
  const week: CalDay[] = Array.from({ length: days }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1, d + i)); // calendar arithmetic in UTC: no DST
    const ymd = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
    return { key: ymd.join("-"), y: ymd[0], m: ymd[1], d: ymd[2], items: [], free: [] };
  });
  const byKey = new Map(week.map((w) => [w.key, w]));
  for (const j of jobs) for (const c of j.clips) {
    const it = c.publish && itemOf(c.publish, now, live);
    if (it) byKey.get(dayKey(it.at, s.timezone))?.items.push({ job: j.id, clip: c.id, title: c.title, thumb: c.thumb, ...it, error: c.publish?.status === "failed" ? c.publish.error : undefined });
  }
  for (const iso of nextSlots(s, usedSlots(jobs, now), now, s.slots.length * days)) {
    const t = Date.parse(iso);
    byKey.get(dayKey(t, s.timezone))?.free.push(t);
  }
  for (const w of week) w.items.sort((a, b) => a.at - b.at);
  return week;
}
