// OPS05: automation preview. Schedule times are Tallinn wall-clock times (the owner's clock).
// DST: a time that doesn't exist (spring forward, 03:xx on the last Sunday of March) runs one hour later (04:xx);
// a time that happens twice (fall back, 03:xx on the last Sunday of October) runs once, at the first one.
// Missed runs (PC off / asleep): one catch-up run if ORBIT is back within the grace window (30 min hourly, 3 h daily/weekly,
// same as automationDue in pure.ts); later than that the slot is skipped, never run twice, never backfilled.
import type { Schedule } from "./pure";

export const PREVIEW_TZ = "Europe/Tallinn";
export const graceMinutes = (s: Schedule) => (s.every === "hour" ? 30 : 180);

/** Offset of `tz` from UTC at instant `t`, in ms. */
function offset(t: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60_000) * 60_000;
}

/** The instant of local wall time y-m-d h:mi in tz, with the DST rules above. */
export function localToUtc(y: number, m: number, d: number, h: number, mi: number, tz = PREVIEW_TZ) {
  const wall = Date.UTC(y, m, d, h, mi);
  const before = offset(wall - 86_400_000, tz), after = offset(wall + 86_400_000, tz);
  const fits = [before, after].map((o) => wall - o).filter((t) => wall - offset(t, tz) === t);
  return fits.length ? Math.min(...fits) : wall - before; // gap: the pre-change offset lands one hour later on the clock
}

/** The next n run times after `from` (exclusive). */
export function nextOccurrences(s: Schedule, from: Date, n = 3, tz = PREVIEW_TZ): Date[] {
  const out: Date[] = [];
  const min = s.minute ?? 0;
  if (s.every === "hour") { // Tallinn offsets are whole hours: :mm every UTC hour
    let t = Math.floor(from.getTime() / 3_600_000) * 3_600_000 + min * 60_000;
    while (out.length < n) { if (t > from.getTime()) out.push(new Date(t)); t += 3_600_000; }
    return out;
  }
  const local = new Date(from.getTime() + offset(from.getTime(), tz)); // its UTC fields read as the local date
  for (let i = 0; out.length < n && i < 7 * n + 8; i++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i));
    if (s.every === "week" && day.getUTCDay() !== (s.weekday ?? 0)) continue;
    const t = localToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), s.hour ?? 9, min, tz);
    if (t > from.getTime()) out.push(new Date(t));
  }
  return out;
}

/** Latest finished run with this outcome (runs are newest first). */
export const lastWith = <R extends { status: string }>(runs: R[], status: "done" | "failed") => runs.find((r) => r.status === status) ?? null;
