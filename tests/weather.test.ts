import { test } from "node:test";
import assert from "node:assert/strict";
import { codeWords, forecastUrl, parseForecast, rainWindow, weatherLine, weatherPlace, type Forecast } from "../src/lib/weather-pure.ts";
import { briefItems } from "../src/lib/brief-pure.ts";

const day = "2026-10-26";
/** 24 hourly slots; per-hour overrides for code and rain chance. */
const fc = (temps: (h: number) => number, wetHours: number[] = [], code = 61): Forecast => {
  const hrs = [...Array(24).keys()];
  return { time: hrs.map((h) => `${day}T${String(h).padStart(2, "0")}:00`), temp: hrs.map(temps),
    rainPct: hrs.map((h) => (wetHours.includes(h) ? 80 : 5)), code: hrs.map((h) => (wetHours.includes(h) ? code : 3)) };
};
const mild = (h: number) => 4 + Math.max(0, 5 - Math.abs(h - 14)); // 4 at night, 9 at 14:00

test("codeWords: WMO codes to words", () => {
  assert.equal(codeWords(0), "clear");
  assert.equal(codeWords(2), "partly cloudy");
  assert.equal(codeWords(45), "foggy");
  assert.equal(codeWords(53), "drizzle");
  assert.equal(codeWords(81), "rain");
  assert.equal(codeWords(73), "snow");
  assert.equal(codeWords(95), "thunderstorms");
});

test("rainWindow: first wet stretch from the given hour, null when dry", () => {
  assert.equal(rainWindow(fc(mild), 7), null);
  assert.deepEqual(rainWindow(fc(mild, [15, 16, 17, 18, 19, 20, 21, 22, 23]), 7), { word: "rain", from: 15, to: 23 });
  assert.deepEqual(rainWindow(fc(mild, [3, 9, 10, 11, 18]), 7), { word: "rain", from: 9, to: 12 }); // night rain ignored, stops at the first gap
  assert.equal(rainWindow(fc(mild, [9, 10]), 12), null); // already over
  assert.equal(rainWindow(fc(mild, [10], 73), 7)?.word, "snow");
});

test("weatherLine: the example line, and the dry / all-day / snow cases", () => {
  const rain = weatherLine(fc(mild, [15, 16, 17, 18, 19, 20, 21, 22]), "Tallinn", 7, day)!;
  assert.equal(rain.title, "4–9°C, rain after 15:00");
  assert.equal(rain.say, "Around Tallinn today: 4 to 9 degrees, rain after 15:00, so take a jacket.");
  assert.equal(rain.id, `weather:${day}`);
  assert.equal(weatherLine(fc(mild, [6, 7, 8, 9, 10, 11]), "Home", 7, day)!.title, "4–9°C, rain until 12:00");
  assert.equal(weatherLine(fc(mild, [12, 13]), "Home", 7, day)!.title, "4–9°C, rain 12:00–14:00");
  assert.equal(weatherLine(fc(mild, [...Array(24).keys()]), "Home", 7, day)!.title, "4–9°C, rain all day");
  assert.equal(weatherLine(fc(() => 18), "Home", 7, day)!.say, "Around Home today: 18 degrees, cloudy.");
  assert.match(weatherLine(fc(() => -3, [11], 73), "Home", 7, day)!.say, /snow 11:00 to 12:00, so dress warm\.$/);
  assert.equal(weatherLine({ time: [], temp: [], rainPct: [], code: [] }, "Home", 7, day), null);
});

test("parseForecast: Open-Meteo shape in, junk out; URL sends only ~10 km coordinates", () => {
  const ok = { hourly: { time: [`${day}T00:00`], temperature_2m: [4.2], precipitation_probability: [10], weather_code: [3] } };
  assert.deepEqual(parseForecast(ok), { time: [`${day}T00:00`], temp: [4.2], rainPct: [10], code: [3] });
  for (const bad of [null, {}, { hourly: { time: [] } }, { hourly: { ...ok.hourly, weather_code: [] } }, { hourly: { ...ok.hourly, time: [1] } }]) assert.equal(parseForecast(bad), null);
  const u = forecastUrl(59.4372, 24.7536);
  assert.match(u, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=59\.4&longitude=24\.8&/);
  assert.match(u, /hourly=temperature_2m,precipitation_probability,weather_code/);
});

test("weatherPlace: phone's nearby place when on and fresh, else the PC place, else none", () => {
  const now = Date.parse(`${day}T07:00:00Z`);
  const home = { name: "Home", lat: 59.44, lon: 24.75, pc: true }, tartu = { name: "Tartu", lat: 58.38, lon: 26.73 };
  const last = { lat: 58.38, lon: 26.72, at: new Date(now - 3_600_000).toISOString() };
  assert.equal(weatherPlace({ on: true, places: [home, tartu], last }, now)?.name, "Tartu");
  assert.equal(weatherPlace({ on: false, places: [home, tartu], last }, now)?.name, "Home");
  assert.equal(weatherPlace({ on: true, places: [home, tartu], last: { ...last, at: new Date(now - 13 * 3_600_000).toISOString() } }, now)?.name, "Home");
  assert.equal(weatherPlace({ on: true, places: [tartu] }, now), null);
});

test("briefItems: the weather line lands as a weather item", () => {
  const w = weatherLine(fc(mild, [15, 16]), "Home", 7, day)!;
  const items = briefItems({ day, hour: 7, life: false, morning: {} as never, decisions: [], replies: [], snoozed: [], weather: w });
  assert.deepEqual(items.map((i) => [i.kind, i.say]), [["weather", w.say]]);
});
