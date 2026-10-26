// Morning-brief weather line (pure, tested in tests/weather.test.ts). Source: Open-Meteo's free no-key forecast (weather.ts),
// asked for the saved place's coordinates rounded to ~10 km. Only the place's saved name and the forecast reach the brief.
import { currentPoint, nearestPlace, type Place, type PlaceState } from "./place-pure.ts";

/** Hourly forecast for one local day; hours are "YYYY-MM-DDTHH:MM" local time (timezone=auto). */
export type Forecast = { time: string[]; temp: number[]; rainPct: number[]; code: number[] };

/** ~11 km grid: enough for a city forecast, too coarse to say which street. */
export const weatherGrid = (v: number) => Math.round(v * 10) / 10;

/** Which saved place to forecast: the one the phone is near (when the opt-in is on and the point is fresh), else the PC's place. */
export function weatherPlace(s: PlaceState, now: number): Place | null {
  const p = currentPoint(s, now);
  return (p && nearestPlace(p, s.places)) || s.places.find((x) => x.pc) || null;
}

export const forecastUrl = (lat: number, lon: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${weatherGrid(lat)}&longitude=${weatherGrid(lon)}`
  + "&hourly=temperature_2m,precipitation_probability,weather_code&timezone=auto&forecast_days=1";

/** Open-Meteo's JSON → Forecast, or null when the shape is off (untrusted input). */
export function parseForecast(raw: unknown): Forecast | null {
  const h = (raw as { hourly?: Record<string, unknown> } | null)?.hourly;
  const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : NaN)) : null);
  const time = Array.isArray(h?.time) && h.time.every((t) => typeof t === "string") ? (h.time as string[]) : null;
  const temp = nums(h?.temperature_2m), rainPct = nums(h?.precipitation_probability), code = nums(h?.weather_code);
  if (!time?.length || !temp || !rainPct || !code || [temp, rainPct, code].some((a) => a.length !== time.length)) return null;
  return { time: time.slice(0, 48), temp: temp.slice(0, 48), rainPct: rainPct.slice(0, 48), code: code.slice(0, 48) };
}

/** WMO weather code (Open-Meteo's weather_code) → a few plain words. */
export function codeWords(c: number): string {
  if (c === 0) return "clear";
  if (c <= 2) return "partly cloudy";
  if (c === 3) return "cloudy";
  if (c === 45 || c === 48) return "foggy";
  if (c >= 51 && c <= 57) return "drizzle";
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 95 && c <= 99) return "thunderstorms";
  return "mixed weather";
}
const wet = (code: number, pct: number) => (code >= 51 && code <= 99 && code !== 45 && code !== 48) || pct >= 60;

const hourOf = (t: string) => Number(t.slice(11, 13));
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** The first wet stretch from `fromHour` to 22:00 today: { word, from, to } (to = last wet hour + 1), or null when dry. */
export function rainWindow(f: Forecast, fromHour: number): { word: string; from: number; to: number } | null {
  let start = -1, end = -1;
  for (let i = 0; i < f.time.length; i++) {
    const h = hourOf(f.time[i]);
    if (f.time[i].slice(0, 10) !== f.time[0].slice(0, 10) || h < fromHour || h > 22) continue;
    if (wet(f.code[i], f.rainPct[i])) { if (start < 0) start = i; end = i; } else if (start >= 0) break;
  }
  if (start < 0) return null;
  const top = f.code.slice(start, end + 1).reduce((a, b) => Math.max(a, b), 0); // the worst hour names it
  const w = codeWords(top);
  return { word: w === "drizzle" || w === "mixed weather" || w === "partly cloudy" || w === "clear" || w === "cloudy" ? "rain" : w, from: hourOf(f.time[start]), to: hourOf(f.time[end]) + 1 };
}

export type WeatherLine = { id: string; title: string; say: string };

/** "Around Home today: 4 to 9 degrees, rain after 15:00, so take a jacket." Daytime (07–22) temperatures; null if no daytime hours. */
export function weatherLine(f: Forecast, placeName: string, fromHour: number, day: string): WeatherLine | null {
  const today = f.time[0]?.slice(0, 10); // the place's own date (timezone=auto)
  const idx = f.time.map((_, i) => i).filter((i) => f.time[i].slice(0, 10) === today && hourOf(f.time[i]) >= 7 && hourOf(f.time[i]) <= 22 && Number.isFinite(f.temp[i]));
  if (!idx.length) return null;
  const ts = idx.map((i) => f.temp[i]);
  const lo = Math.round(Math.min(...ts)), hi = Math.round(Math.max(...ts));
  const r = rainWindow(f, Math.max(fromHour, 7));
  const what = r
    ? r.from <= Math.max(fromHour, 7) && r.to >= 22 ? `${r.word} all day` : r.from <= Math.max(fromHour, 7) ? `${r.word} until ${hh(r.to)}` : r.to >= 22 ? `${r.word} after ${hh(r.from)}` : `${r.word} ${hh(r.from)}–${hh(r.to)}`
    : codeWords(Math.max(...idx.map((i) => f.code[i]).filter(Number.isFinite)));
  const tip = r?.word === "snow" || hi <= 0 ? "dress warm" : r?.word === "thunderstorms" ? "maybe stay in for that bit" : r ? "take a jacket" : hi <= 5 ? "it's a cold one" : "";
  const temps = lo === hi ? `${lo}°C` : `${lo}–${hi}°C`;
  return {
    id: `weather:${day}`,
    title: `${temps}, ${what}`,
    say: `Around ${placeName} today: ${lo === hi ? `${lo}` : `${lo} to ${hi}`} degrees, ${what.replace("–", " to ")}${tip ? `, so ${tip}` : ""}.`,
  };
}
