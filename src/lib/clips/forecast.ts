import { access } from "node:fs/promises";
import path from "node:path";
import { readState, saveState, studioRoot } from "./factory";
import { learnView } from "./learn";
import { emptyLearn, learnProblem, type LearnState } from "./learn-pure";
import { accuracy, emptyForecasts, forecastAll, forecastProblem, hintFor, remember, type Accuracy, type Forecast, type ForecastState, type Hint } from "./forecast-pure";

// 7-day view forecasts for recent Shorts (STUDIO Stats). Read-only: learn.json in, <studio>/forecasts.json (first forecast per Short) out.

export type ForecastView = { items: (Forecast & { hint: Hint | null })[]; accuracy: Accuracy | null; history: number };

const file = () => path.join(studioRoot(), "forecasts.json");
const g = globalThis as unknown as { __orbitForecast?: Promise<unknown> };

export async function forecastView(now = Date.now()): Promise<ForecastView> {
  const i = await learnView(); // collects due stats first, like Last Shorts
  const recs = Object.values(((await readState<LearnState>(studioRoot(), "learn", learnProblem)) ?? emptyLearn()).clips);
  const fs = forecastAll(recs, now);
  const p = (g.__orbitForecast ?? Promise.resolve()).then(async () => { // serialised read-modify-write
    const s = await readState<ForecastState>(studioRoot(), "forecasts", forecastProblem);
    if (!s && await access(file()).then(() => true, () => false)) return s; // locked/unreadable: never reset stored forecasts
    const base = s ?? emptyForecasts(), next = remember(base, fs, now);
    if (next) await saveState("forecasts", file(), next);
    return next ?? base;
  });
  g.__orbitForecast = p.catch(() => {});
  const stored = await p.catch((e) => { console.error("[orbit] forecasts:", e instanceof Error ? e.message : e); return null; });
  const byId = new Map(recs.map((r) => [r.videoId, r]));
  return { items: fs.map((f) => ({ ...f, hint: hintFor(byId.get(f.videoId)!, recs, i) })), accuracy: stored ? accuracy(stored, recs) : null,
    history: recs.filter((r) => r.snaps["7d"]).length };
}
