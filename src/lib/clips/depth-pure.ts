// STUDIO depth (pure, server side; tested in tests/studio-depth.test.ts): STU07 calendar capacity and exceptions, STU06 outcomes
// joined to the exact published revision. Nothing here renders, schedules or publishes. STU05 editing helpers: edit-pure.ts.
import type { Clip, ClipJob } from "./types.ts";
import type { ProdRecord } from "./production-pure.ts";
import { renderEstimate } from "./edit-pure.ts";
import type { PublishSettings } from "./schedule.ts";
import type { LearnRec, SnapKey, Stats } from "./learn-pure.ts";
import { weekCalendar } from "./calendar-pure.ts";
import { BASE_MIN, baseline } from "./experiments-pure.ts";
import { median } from "./learn-pure.ts";

// ---- STU07: calendar capacity ----
export const REVIEW_MIN = 2; // assumed minutes to review one clip; shown as an assumption, never as measured
const DAY = 86_400_000;
export type CapDay = { key: string; planned: number; confirmed: number; free: number };
export type Exception = { id: string; title: string; why: string };
export type Capacity = { timezone: string; days: CapDay[]; free: number; readyToSchedule: number; awaitingReview: number; reviewMinutes: number; reviewEach: number;
  rendering: number; renderMinutes: number | null; gap: number; exceptions: Exception[] };

/** Videos seen public: a learn.json reading with views. A scheduled upload is only "confirmed published" once one exists. */
export const liveIds = (recs: Pick<LearnRec, "videoId" | "snaps" | "latest">[]) =>
  new Set(recs.filter((r) => [r.latest, ...Object.values(r.snaps)].some((s) => (s?.views ?? 0) > 0)).map((r) => r.videoId));

/** Next 7 local days in the publish zone (Europe/Tallinn by default): planned and confirmed counted apart, free windows, what can
 *  fill them (ready, awaiting review, rendering) and every planned item whose dependency failed, as an exception. */
export function capacity(records: ProdRecord[], jobs: ClipJob[], s: PublishSettings, now: number, live = new Set<string>()): Capacity {
  const week = weekCalendar(jobs, s, now, 7, live);
  const days = week.map((d) => ({ key: d.key, planned: d.items.filter((i) => i.status !== "published" && i.status !== "failed").length,
    confirmed: d.items.filter((i) => i.status === "published").length, free: d.free.length }));
  const free = days.reduce((n, d) => n + d.free, 0);
  const readyToSchedule = records.filter((r) => !r.blockers.length && !r.publication).length;
  const awaitingReview = records.filter((r) => r.review.status === "ready").length;
  let rendering = 0, renderSec = 0, unknown = false;
  for (const j of jobs) {
    const k = j.clips.filter((c) => c.status === "rendering").length, est = renderEstimate(j);
    rendering += k; if (k && est === null) unknown = true; else renderSec += k * (est ?? 0);
  }
  const exceptions: Exception[] = [];
  for (const r of records) {
    const p = r.publication, at = Date.parse(p?.scheduledFor ?? "");
    if (p?.status === "failed") exceptions.push({ id: r.id, title: r.title, why: `Upload failed: ${p.error ?? "no reason given"}` });
    else if (p?.status === "scheduled" && at > now && r.blockers.length) exceptions.push({ id: r.id, title: r.title, why: `Planned, but: ${r.blockers[0]}` });
    else if (p?.status === "scheduled" && at <= now - DAY && !(p.videoId && live.has(p.videoId))) exceptions.push({ id: r.id, title: r.title, why: "Due over a day ago and not confirmed live" });
    else if ((p?.status === "unknown") || (p?.status === "uploading" && Date.parse(p.at) < now - DAY)) exceptions.push({ id: r.id, title: r.title, why: "Upload outcome unknown: check YouTube" });
  }
  return { timezone: s.timezone, days, free, readyToSchedule, awaitingReview, reviewMinutes: awaitingReview * REVIEW_MIN, reviewEach: REVIEW_MIN, rendering,
    renderMinutes: unknown ? null : Math.ceil(renderSec / 60), gap: Math.max(0, free - readyToSchedule), exceptions };
}

// ---- STU06: outcomes of the exact published revision ----
export type Reading = { snap: SnapKey; at: string } & Pick<Stats, "views" | "likes" | "comments" | "avgViewPct" | "avgViewSec">;
export type OutcomeLimit = "oneShort" | "notExact" | "noReading" | "fewBase" | "noImpressions";
export type Outcome = { videoId: string; revision: string; mediaHash?: string; exact: boolean; publishedAt?: string; readings: Reading[];
  vsUsual?: { ratio: number; snap: SnapKey; n: number; likeForLike: boolean }; limits: OutcomeLimit[] };
const ORDER: SnapKey[] = ["24h", "48h", "72h", "7d"];

/** What the published revision did: its own readings (dated), retention and watch time where YouTube gave them, and views against
 *  comparable Shorts at the same age only with ≥ BASE_MIN of them. Impressions/CTR aren't collected, so they're named as missing. */
export function outcomeOf(clip: Pick<Clip, "id" | "publish" | "approvedMedia">, recs: LearnRec[]): Outcome | null {
  const p = clip.publish;
  if (!p?.videoId || !(p.status === "done" || p.status === "scheduled")) return null;
  const rec = recs.find((r) => r.videoId === p.videoId);
  const exact = !!p.mediaHash && p.mediaHash === clip.approvedMedia;
  const readings = rec ? ORDER.flatMap((k) => { const s = rec.snaps[k]; return s ? [{ snap: k, at: s.at, views: s.views, likes: s.likes, comments: s.comments, avgViewPct: s.avgViewPct, avgViewSec: s.avgViewSec }] : []; }) : [];
  const limits: OutcomeLimit[] = ["oneShort", "noImpressions"];
  if (!exact) limits.push("notExact");
  if (!readings.length) limits.push("noReading");
  let vsUsual: Outcome["vsUsual"];
  const last = readings.at(-1);
  if (rec && last) {
    const b = baseline(rec, recs, last.snap);
    if (b.views.length >= BASE_MIN) vsUsual = { ratio: Math.round((last.views / Math.max(1, median(b.views))) * 100) / 100, snap: last.snap, n: b.views.length, likeForLike: b.likeForLike };
    else limits.push("fewBase");
  }
  return { videoId: p.videoId, revision: clip.id, mediaHash: p.mediaHash, exact, publishedAt: rec?.publishedAt ?? p.scheduledFor ?? p.at, readings, vsUsual, limits };
}
