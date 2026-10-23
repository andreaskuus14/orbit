import { sunPosition } from "./sun-pure.ts";

export type DayNightOptions = { timeZone?: string; latitude?: number; longitude?: number };
export type DayNight = {
  elevationDeg: number; azimuthDeg: number;
  phase: "night" | "dawn" | "day" | "dusk";
  lightFactor: number; palette: { sky: string; rim: string; ambient: string };
  timeZone: string; localDate: string | null;
};
export const DAYNIGHT_DEFAULTS = { timeZone: "Europe/Tallinn", latitude: 59.437, longitude: 24.754 } as const;
export const SUNRISE_ELEVATION = -0.833; // standard solar centre horizon: refraction + radius
const NIGHT = { sky: "#02030b", rim: "#17133b", ambient: "#08091b" };
const TWILIGHT = { sky: "#0b1936", rim: "#7963ac", ambient: "#182d43" };
const DAY = { sky: "#093c43", rim: "#87ead6", ambient: "#385d65" };
const smooth = (lo: number, hi: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const blend = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");

/** Date is an instant, never reinterpreted as a wall-clock time. The zone labels its local date only;
 * astronomy is independent of timezone/DST. Invalid zones use Tallinn; invalid dates/coordinates
 * or unusable solar results return a fresh, finite night state. Sunrise/set are at -0.833°, civil
 * twilight at -6°. Dawn/dusk follow elevation's slope, including seasonal twilight at the poles.
 * Phase/date labels are discrete; light and RGB interpolation are continuous (hex rounds to 8 bits).
 * Azimuth is circular, north=0°, clockwise. No event search is needed for lighting at the poles. */
export function dayNight(date: Date, options: DayNightOptions = {}): DayNight {
  const latitude = options.latitude ?? DAYNIGHT_DEFAULTS.latitude, longitude = options.longitude ?? DAYNIGHT_DEFAULTS.longitude;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone ?? DAYNIGHT_DEFAULTS.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: DAYNIGHT_DEFAULTS.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  }
  const timeZone = formatter.resolvedOptions().timeZone;
  const fallback = (): DayNight => ({ elevationDeg: -90, azimuthDeg: 0, phase: "night", lightFactor: 0, palette: { ...NIGHT }, timeZone, localDate: null });
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return fallback();
  const sun = sunPosition(latitude, longitude, date);
  if (!Number.isFinite(sun.elevationDeg) || !Number.isFinite(sun.azimuthDeg)) return fallback();
  const parts = formatter.formatToParts(date), field = (name: string) => parts.find((p) => p.type === name)!.value;
  const localDate = `${field("year")}-${field("month")}-${field("day")}`;
  const height = (offset: number) => sunPosition(latitude, longitude, new Date(Math.max(-8.64e15, Math.min(8.64e15, date.getTime() + offset)))).elevationDeg;
  const rising = height(60_000) >= height(-60_000);
  const phase = sun.elevationDeg >= SUNRISE_ELEVATION ? "day" : sun.elevationDeg <= -6 ? "night" : rising ? "dawn" : "dusk";
  const lo = sun.elevationDeg < -2 ? NIGHT : TWILIGHT, hi = sun.elevationDeg < -2 ? TWILIGHT : DAY;
  const mix = sun.elevationDeg < -2 ? smooth(-12, -2, sun.elevationDeg) : smooth(-2, 20, sun.elevationDeg);
  return { ...sun, phase, lightFactor: smooth(-12, 20, sun.elevationDeg),
    palette: { sky: blend(lo.sky, hi.sky, mix), rim: blend(lo.rim, hi.rim, mix), ambient: blend(lo.ambient, hi.ambient, mix) }, timeZone, localDate };
}
