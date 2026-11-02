// Living universe: a ledger snapshot → how the galaxy lights up (vitality, comets, moons, nebula), plus the time-scrub math. Pure.
import { PLANETS } from "./planets.ts";
import type { Snapshot } from "./ledger-pure.ts";

export type Light = { glow: number; orbit: number; dim: number }; // all finite, 0..1
export type Universe = {
  vitality: Record<string, number>; // 0..1 per planet
  light: Record<string, Light>;
  comets: number; // STUDIO streaks, 0..5
  moons: number; // BUSINESS paying clients, 0..8
  nebula: number; // MEMORY nebula density, 0..1
  recent: Record<string, number>; // events per planet in the last 7 days (counts only)
  today: Record<string, number>; // … in the last 24 h: the world glows "new today" on hover
  stages: Partial<Snapshot["businessStages"]>; // BUSINESS prospects by their latest stage
};

const DAY = 86_400_000;
export const SCRUB_DAYS = 180;
const COMET_WINDOW = 14 * DAY; // a clip's outcome lights a comet for two weeks
const fin = (v: number) => (Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0);
const cnt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Zero data → all zeros, so the galaxy looks exactly like it does without a ledger. */
export function universeFrom(snap: Snapshot | null | undefined, atMs: number): Universe {
  const recent = snap?.recent ?? {};
  const n = Object.fromEntries(PLANETS.map((p) => [p.id, cnt(recent[p.id])]));
  const top = Math.max(0, ...Object.values(n));
  // log scale against the busiest planet, but never fewer than 10 events for "full": one event isn't a blaze
  const den = Math.log1p(Math.max(10, top));
  const vitality = Object.fromEntries(PLANETS.map((p) => [p.id, fin(Math.log1p(n[p.id]) / den)]));
  const any = top > 0;
  const light = Object.fromEntries(PLANETS.map((p) => {
    const v = vitality[p.id];
    return [p.id, { glow: v, orbit: v, dim: any ? fin(0.15 * (1 - v)) : 0 }];
  }));

  const outs = (snap?.lastClipOutcomes ?? []).filter((c) => { const t = Date.parse(c.at); return t <= atMs && atMs - t < COMET_WINDOW; });
  const views = outs.map((c) => cnt(c.views)).sort((a, b) => a - b);
  const mid = views.length ? (views.length % 2 ? views[views.length >> 1] : (views[views.length / 2 - 1] + views[views.length / 2]) / 2) : 0;
  const comets = Math.min(5, views.filter((v) => v > mid).length);

  const moons = Math.min(8, Math.floor(cnt(snap?.businessStages?.paying)));
  const nebula = fin(Math.log1p(cnt(snap?.counts?.["memory.saved"])) / Math.log1p(200));
  const today = Object.fromEntries(PLANETS.map((p) => [p.id, cnt(snap?.today?.[p.id])])); // older cached snapshots have none
  return { vitality, light, comets, moons, nebula, recent: n, today, stages: { ...snap?.businessStages } };
}

/** Slider value (days ago, 0..180) → the moment to ask the ledger about; null = live. Whole hours so the cache hits. */
export function scrubAt(daysAgo: number, nowMs: number): string | null {
  const d = Math.round(Number.isFinite(daysAgo) ? Math.min(SCRUB_DAYS, Math.max(0, daysAgo)) : 0);
  if (d === 0) return null;
  return new Date(Math.floor((nowMs - d * DAY) / 3_600_000) * 3_600_000).toISOString();
}
