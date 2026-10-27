// Morning-brief weather, server side: ONE Open-Meteo fetch per local day and place (read-only GET, no key, 5 s timeout),
// cached in <data dir>/weather.json. The day's try is recorded before the fetch, so a failure means no line today, not a retry loop.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { localDay } from "./morning-pure";
import type { PlaceState } from "./place-pure";
import { forecastUrl, parseForecast, weatherGrid, weatherLine, weatherPlace, type Forecast, type WeatherLine } from "./weather-pure";

type Cache = { day: string; at: string; f?: Forecast };
const file = () => path.join(orbitDataDir(), "weather.json");
const save = async (c: Cache) => {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(c));
  await rename(file() + ".tmp", file());
};

let inflight: Promise<Forecast | undefined> | null = null; // brief + phone opener may ask at once: one fetch
async function forecast(day: string, lat: number, lon: number): Promise<Forecast | undefined> {
  const at = `${weatherGrid(lat)},${weatherGrid(lon)}`;
  const c: Cache | null = await readFile(file(), "utf8").then((t) => JSON.parse(t), () => null);
  if (inflight) return inflight; // the cache already says "tried" while this runs
  if (c?.day === day && c.at === at) return c.f; // our own file; undefined = today's one try already failed
  return (inflight = (async () => {
    await save({ day, at });
    const r = await fetch(forecastUrl(lat, lon), { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    const f = parseForecast(await r.json());
    if (!f) throw new Error("open-meteo: unexpected shape");
    await save({ day, at, f });
    return f;
  })().catch((e) => { console.error("[weather]", e instanceof Error ? e.message : e); return undefined; }).finally(() => { inflight = null; }));
}

/** Today's weather line for the brief, or null (no saved place, fetch failed, or nothing for today). */
export async function briefWeather(s: PlaceState, now = Date.now()): Promise<WeatherLine | null> {
  const place = weatherPlace(s, now);
  if (!place) return null;
  const d = new Date(now), day = localDay(d);
  const f = await forecast(day, place.lat, place.lon);
  return f ? weatherLine(f, place.name, d.getHours(), day) : null;
}
