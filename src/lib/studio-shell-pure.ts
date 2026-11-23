// STUDIO in the planet look (reports/design-language.md + the MIX reference frames in reports/hf-refs/studio-*.png):
// the numbers and words behind StudioShell.tsx. Pure; tested in tests/studio-shell.test.ts.
//   - the Shorts pipeline (Find → Cut → Check → Post) from the real clip jobs, downloads and clip states
//   - the header status line, the pace badge ("2.4× pace"), relative dates
//   - which failed jobs are already covered by a Needs you item (so one failure is shown once, not twice)
//   - the retention chart: path, biggest drop, axis ticks
import type { Lang } from "./i18n-pure.ts";

/* ---------- pipeline ---------- */

export type StageKey = "find" | "cut" | "check" | "post";
export const STAGES: readonly StageKey[] = ["find", "cut", "check", "post"];
type JobLike = { id: string; status: string; progress?: number; source?: string; clips?: { status: string; publish?: { status: string } }[] };
type DlLike = { status: string; progress?: number };
export type Stage = { key: StageKey; n: number; live: boolean; share: number | null }; // share: 0..1 progress of the running item, null = nothing running

const CUTTING = new Set(["probing", "transcribing", "finding", "rendering"]);
/** Where each piece of Shorts work is now. find = downloading or waiting to start; cut = a job is being cut; check = clips waiting
 *  for his review; post = approved clips waiting to go out, uploading or scheduled. Published clips are done and not counted. */
export function pipeline(jobs: readonly JobLike[], downloads: readonly DlLike[]): Stage[] {
  const fin = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
  const dls = downloads.filter((d) => d.status === "queued" || d.status === "downloading");
  const queued = jobs.filter((j) => j.status === "queued");
  const cutting = jobs.filter((j) => CUTTING.has(j.status));
  const clips = jobs.flatMap((j) => j.clips ?? []);
  const ready = clips.filter((c) => c.status === "ready");
  const post = clips.filter((c) => c.status === "approved" || c.status === "scheduled" || c.publish?.status === "uploading" || c.publish?.status === "scheduled");
  const dlLive = dls.filter((d) => d.status === "downloading");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [
    { key: "find", n: dls.length + queued.length, live: dlLive.length > 0, share: avg(dlLive.map((d) => fin(d.progress))) },
    { key: "cut", n: cutting.length, live: cutting.length > 0, share: avg(cutting.map((j) => fin(j.progress))) },
    { key: "check", n: ready.length, live: false, share: null },
    { key: "post", n: post.length, live: post.some((c) => c.publish?.status === "uploading"), share: null },
  ];
}

/* ---------- words and numbers ---------- */

/** "2.4×" under 10, "134×" from 10 up (a tenth means nothing at that size). */
export const paceText = (ratio: number) => (!Number.isFinite(ratio) || ratio <= 0 ? "" : ratio < 10 ? `${ratio.toFixed(1)}×` : `${Math.round(ratio)}×`);

const cf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const compactN = (x: number) => cf.format(Number.isFinite(x) ? x : 0);

/** "today", "yesterday", "3 days ago", "2 weeks ago", then the date. */
export function ago(iso: string, now: number, lang: Lang): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = Math.floor((now - t) / 86_400_000);
  const et = lang === "et";
  if (d <= 0) return et ? "täna" : "today";
  if (d === 1) return et ? "eile" : "yesterday";
  if (d < 14) return et ? `${d} päeva tagasi` : `${d} days ago`;
  if (d < 60) return et ? `${Math.round(d / 7)} nädalat tagasi` : `${Math.round(d / 7)} weeks ago`;
  return new Date(t).toLocaleDateString(et ? "et-EE" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The header's one status line: subscribers, then the freshest fact (Shorts to check, else videos taking off, else video count). ≤ 3 parts. */
export function statusParts(x: { subs: number | null; videos: number; hot: number; toCheck: number; connected: boolean }): { key: string; vars?: Record<string, string | number> }[] {
  if (!x.connected) return [{ key: "sx.status.off" }];
  const out: { key: string; vars?: Record<string, string | number> }[] = [];
  if (x.subs !== null) out.push({ key: "sx.status.subs", vars: { n: compactN(x.subs) } });
  if (x.toCheck > 0) out.push({ key: x.toCheck === 1 ? "sx.status.check1" : "sx.status.check", vars: { n: x.toCheck } });
  else if (x.hot > 0) out.push({ key: "sx.status.hot", vars: { n: x.hot } });
  else out.push({ key: "sx.status.videos", vars: { n: x.videos } });
  return out;
}

/** Failed clip jobs that a Needs you item already names (by the source file), so the failure shows once (in Needs you). */
export function coveredFailures(jobs: readonly JobLike[], needTitles: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const j of jobs) if (j.status === "failed" && j.source && needTitles.some((t) => t.includes(j.source!))) out.add(`clip:${j.id}`);
  return out;
}

/* ---------- retention chart ---------- */

export type RetPt = { t: number; ratio: number };
/** The steepest fall over a window of `win` (share of the video): where viewers leave. null when the curve is too short. */
export function biggestDrop(pts: readonly RetPt[], win = 0.1): { t: number; drop: number } | null {
  const p = pts.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.ratio)).slice().sort((a, b) => a.t - b.t);
  if (p.length < 3) return null;
  let best: { t: number; drop: number } | null = null;
  for (let i = 1; i < p.length; i++) { // skip the first point: the start always falls (people who only peek)
    if (p[i].t < 0.05) continue;
    let j = i; while (j + 1 < p.length && p[j + 1].t - p[i].t <= win) j++;
    const drop = p[i].ratio - p[j].ratio;
    if (j > i && (!best || drop > best.drop)) best = { t: p[i].t, drop };
  }
  return best && best.drop > 0.02 ? best : null;
}

/** Points in an SVG box (x0..x1, y top..bottom), ratio 0..max(1, data). */
export function retentionPoints(pts: readonly RetPt[], box: { x0: number; x1: number; y0: number; y1: number }) {
  const p = pts.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.ratio)).slice().sort((a, b) => a.t - b.t);
  const top = Math.max(1, ...p.map((x) => x.ratio));
  return p.map((x) => ({ x: box.x0 + Math.max(0, Math.min(1, x.t)) * (box.x1 - box.x0), y: box.y1 - (Math.max(0, x.ratio) / top) * (box.y1 - box.y0) }));
}

/** m:ss of a share of a video of `durationSec`. */
export function at(t: number, durationSec: number): string {
  const s = Math.max(0, Math.round((Number.isFinite(t) ? t : 0) * (Number.isFinite(durationSec) ? durationSec : 0)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The "…" menu, in order. Ids are the StudioWorld modes they open (unchanged, so links and CORE keep working). */
export const TOOL_MENU = [
  { id: "clips", label: "sx.tool.clips" }, { id: "stats", label: "sx.tool.stats" }, { id: "production", label: "sx.tool.production" },
  { id: "sites", label: "sx.tool.sites" }, { id: "other", label: "sx.tool.other" },
] as const;
