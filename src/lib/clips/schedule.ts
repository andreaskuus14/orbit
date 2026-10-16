// Clip Factory scheduled publishing: pure slot math (no server imports; tested). Times are ISO strings / epoch ms; slots are
// "HH:MM" wall-clock times in the owner's time zone, resolved through Intl so DST is handled.

export type PublishSettings = { timezone: string; slots: string[]; perDay: number };
export const DEFAULT_PUBLISH: PublishSettings = { timezone: "Europe/Tallinn", slots: ["12:00", "17:00", "21:00"], perDay: 3 };
/** YouTube needs a scheduled video private with publishAt in the future; we keep a margin so the upload finishes first. */
export const MIN_LEAD_MS = 15 * 60_000;
const SLOT_GAP = 30 * 60_000, HORIZON_DAYS = 180; // a slot within 30 min of a scheduled clip is taken

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validTz = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

/** Request body / publish.json → settings (slots sorted, deduped), or a message. */
export function parseSettings(x: unknown): PublishSettings | string {
  if (!isObj(x)) return "settings must be an object";
  if (!validTz(x.timezone)) return "timezone must be an IANA time zone like Europe/Tallinn";
  if (!Array.isArray(x.slots) || !x.slots.length || x.slots.length > 12 || !x.slots.every((s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)))
    return "slots must be 1-12 times like 12:00";
  const slots = [...new Set(x.slots as string[])].sort();
  if (!Number.isInteger(x.perDay) || (x.perDay as number) < 1 || (x.perDay as number) > slots.length) return `perDay must be 1-${slots.length}`;
  return { timezone: x.timezone, slots, perDay: x.perDay as number };
}

const fmts = new Map<string, Intl.DateTimeFormat>(); // building a formatter is the slow part: one per zone
const fmt = (tz: string) => {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })));
  return f;
};
/** Wall clock in tz at instant ms, as [y, m, d, h, min]. */
function wall(ms: number, tz: string): number[] {
  const p = Object.fromEntries(fmt(tz).formatToParts(ms).map((x) => [x.type, x.value]));
  return [p.year, p.month, p.day, p.hour, p.minute].map(Number);
}
const dayKey = (ms: number, tz: string) => wall(ms, tz).slice(0, 3).join("-");

/** The instant when the wall clock in tz shows y-m-d hh:mm (a time skipped by a spring-forward jump lands one hour later). */
export function zonedTime(y: number, m: number, d: number, hhmm: string, tz: string): number {
  const [h, min] = hhmm.split(":").map(Number), guess = Date.UTC(y, m - 1, d, h, min);
  const off = (t: number) => { const w = wall(t, tz); return Date.UTC(w[0], w[1] - 1, w[2], w[3], w[4]) - Math.floor(t / 60_000) * 60_000; };
  const t = guess - off(guess);
  return guess - off(t);
}

/** Publish times (ms) from the last 24 h on: clips scheduled, uploading / unknown with a schedule (they may be on YouTube), and ones
 *  published right away (by upload start). Past ones only count toward today's perDay. */
export function usedSlots(jobs: { clips: { publish?: { status: string; scheduledFor?: string; startedAt?: string; at?: string } }[] }[], now: number): number[] {
  return jobs.flatMap((j) => j.clips.flatMap((c) => {
    const p = c.publish;
    if (!p || !["scheduled", "uploading", "unknown", "done"].includes(p.status)) return [];
    const t = Date.parse((p.scheduledFor ?? (p.status === "done" ? p.startedAt ?? p.at : undefined)) ?? "");
    return t > now - 86_400_000 ? [t] : [];
  }));
}

/** The next `count` free slots (ISO) at least MIN_LEAD_MS + 1 min ahead (videoResource checks later with its own clock): none within 30 min of a used time, at most perDay clips per local day
 *  (used ones included), each one used once. Searches ~6 months ahead (YouTube's limit). */
export function nextSlots(s: PublishSettings, used: number[], now: number, count = 1): string[] {
  const ahead = used.filter((u) => u >= now), out: string[] = [], perDay = new Map<string, number>();
  for (const u of used) { const k = dayKey(u, s.timezone); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  const [y, m, d] = wall(now, s.timezone);
  for (let i = 0; i < HORIZON_DAYS && out.length < count; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)), ymd = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()] as const, key = ymd.join("-");
    let n = perDay.get(key) ?? 0;
    for (const slot of s.slots) {
      if (n >= s.perDay || out.length >= count) break;
      const t = zonedTime(...ymd, slot, s.timezone);
      if (t < now + MIN_LEAD_MS + 60_000 || ahead.some((u) => Math.abs(u - t) < SLOT_GAP)) continue;
      ahead.push(t); out.push(new Date(t).toISOString()); n++;
    }
  }
  return out;
}

