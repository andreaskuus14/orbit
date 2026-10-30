// LIFE reminders (LIF03): wall-clock times in an explicit zone (Europe/Tallinn), not the server's zone, so a restart on a machine
// with another TZ, midnight and DST never shift them. One claim per occurrence (no duplicate notices); a claim long after the slot
// is "missed" (ORBIT was off), otherwise "due". Pure; IO in life.ts, UI in LifePanel.tsx / LifeReminders.tsx.
import type { Reminder, Repeat } from "./life-pure.ts";

export const TZ = "Europe/Tallinn";
/** A claim later than this after the slot means nothing was polling (PC off / ORBIT closed): shown as missed, not as on time. */
export const MISSED_AFTER_MS = 15 * 60_000;

type Parts = { y: number; mo: number; d: number; h: number; mi: number; wd: number };
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function zoned(ms: number, tz = TZ): Parts {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: WD[p.weekday] };
}
const offset = (ms: number, tz: string) => { const z = zoned(ms, tz); return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi) - Math.floor(ms / 60_000) * 60_000; };
/** Wall time in tz → epoch ms. A time skipped by DST (03:30 on the spring-forward night) lands an hour later; a repeated one takes the first. */
export function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz = TZ): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const c = [guess - offset(guess, tz), guess - offset(guess - offset(guess, tz), tz)].sort((x, y) => x - y);
  return c.find((t) => { const z = zoned(t, tz); return z.h === h && z.mi === mi && z.d === d; }) ?? c[1];
}
/** "HH:MM" wall clock of an instant in tz (stored with a repeating reminder). */
export const wallTime = (ms: number, tz = TZ) => { const z = zoned(ms, tz); return `${String(z.h).padStart(2, "0")}:${String(z.mi).padStart(2, "0")}`; };

/** Next slot strictly after now at the reminder's wall time in tz. A reminder missed for days jumps to the next future slot (no burst). */
export function nextSlot(atIso: string, repeat: Repeat, now: number, time?: string, tz = TZ): string {
  const base = zoned(Date.parse(atIso), tz);
  const hm = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  const h = hm ? +hm[1] : base.h, mi = hm ? +hm[2] : base.mi;
  const step = repeat === "weekly" ? 7 : 1;
  for (let k = step; k <= 800; k += step) {
    const day = new Date(Date.UTC(base.y, base.mo - 1, base.d + k)); // calendar day arithmetic in UTC: no DST there
    const t = wallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, tz);
    if (repeat === "weekdays" && (day.getUTCDay() === 0 || day.getUTCDay() === 6)) continue;
    if (t > now) return new Date(t).toISOString();
  }
  return new Date(now + 86_400_000).toISOString();
}

export type Notice = { id: string; text: string; at: string; missed: boolean };
/** Claims the reminder's current occurrence: the notice to show, or null when it isn't due or was already claimed (another window,
 *  a restart). Mutates r: a one-off gets fired, a repeating one moves to its next slot. */
export function claim(r: Reminder, now: number, tz = TZ): Notice | null {
  const at = Date.parse(r.at);
  if (r.fired || !(at <= now)) return null;
  const notice = { id: r.id, text: r.text, at: r.at, missed: now - at > MISSED_AFTER_MS };
  if (r.repeat) r.at = nextSlot(r.at, r.repeat, now, r.time, tz);
  else r.fired = new Date(now).toISOString();
  r.last = { at: notice.at, missed: notice.missed }; // shown in Review until he acknowledges it
  delete r.ack;
  return notice;
}

/** Review list: notices he hasn't acknowledged yet, and occurrences already overdue but not yet claimed. */
export function reviewState(rs: Reminder[], now: number) {
  return {
    unacked: rs.filter((r) => r.last && !r.ack).map((r) => ({ id: r.id, text: r.text, at: r.last!.at, missed: r.last!.missed })),
    overdue: rs.filter((r) => !r.fired && Date.parse(r.at) <= now).map((r) => ({ id: r.id, text: r.text, at: r.at })),
  };
}
