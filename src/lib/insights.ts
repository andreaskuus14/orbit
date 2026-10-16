import path from "node:path";
import { listDownloads, listJobs, readState, saveState, studioRoot } from "./clips/factory";
import { readPublishSettings } from "./clips/publish-schedule";
import { youtubePauseUntil } from "./clips/pure";
import { learnProblem, type LearnState } from "./clips/learn-pure";
import { scoutView } from "./clips/scout";
import { act, detect, emptyInsights, insightsProblem, merge, visible, RUN_EVERY_MS, type InsightState } from "./insights-pure";

// Proactive insights (server glue): reads STUDIO's local files, runs the pure rules, keeps <studio>/insights.json.
// Run from the scout timer (every 15 min) and lazily by GET /api/insights. Never calls an AI or the YouTube API.

const file = () => path.join(studioRoot(), "insights.json");
const g = globalThis as unknown as { __orbitInsights?: { lock: Promise<unknown> } };
const S = (g.__orbitInsights ??= { lock: Promise.resolve() });
const load = async () => (await readState<InsightState>(studioRoot(), "insights", insightsProblem)) ?? emptyInsights();

function update<T>(fn: (s: InsightState) => T | Promise<T>): Promise<T> {
  const p = S.lock.then(async () => { const s = await load(); const r = await fn(s); await saveState("insights", file(), s); return r; });
  S.lock = p.catch(() => {});
  return p;
}

/** Re-detects when the last run is older than `maxAge`; returns the visible suggestions. */
export async function refreshInsights(maxAge = RUN_EVERY_MS) {
  const cur = await S.lock.then(load);
  if (Date.now() - cur.at < maxAge) return visible(cur, Date.now());
  const [jobs, downloads, settings, learn, sv] = await Promise.all([
    listJobs(), listDownloads().catch(() => []), readPublishSettings(),
    readState<LearnState>(studioRoot(), "learn", learnProblem).catch(() => null), scoutView().catch(() => null),
  ]);
  const now = Date.now();
  const found = detect({ now, tz: settings.timezone, jobs, downloads, ytPausedUntil: youtubePauseUntil(downloads, "https://www.youtube.com/", now),
    learn: Object.values(learn?.clips ?? {}), picks: sv?.scout.picks ?? [] });
  const s = await update((s) => Object.assign(s, merge(s, found, now)));
  return visible(s, now);
}

export const actOnInsight = (key: string, op: "dismiss" | "done" | "snooze", hours?: number) => update((s) => act(s, key, op, Date.now(), hours));

/** For CORE: the current suggestions (fresh within a minute). Never throws. */
export const topSuggestions = (k = 3) => refreshInsights(60_000).then((xs) => xs.slice(0, k), () => []);
