// Shorts experiment loop (pure, tested in tests/experiments.test.ts): one hypothesis → the exact published version (video id +
// sha256 of the uploaded file, from clip.publish) → its views vs comparable Shorts at the same age. One Short is never proof:
// a verdict says "consistent with", and a lesson is only proposed after several supported experiments, through the lessons
// acceptance flow (lessons-pure reconcile → he keeps or rejects). Reuses learn-pure (records, median, WIN), forecast-pure.
import { lengthBand, median, WIN, type LearnRec, type SnapKey } from "./learn-pure.ts";
import { forecastShort, type Forecast } from "./forecast-pure.ts";
import { normText, type Lesson } from "../lessons-pure.ts";
import type { ClipJob } from "./types.ts";

export const BASE_MIN = 5; // comparable Shorts a verdict needs
export const BASE_DAYS = 90; // comparables published within this many days of the experiment
export const NOT_SUPPORTED = 1; // at or under the baseline median
export const LESSON_MIN = 3; // supported experiments before a lesson is proposed
const DAY = 86_400_000;

export type Arm = { jobId: string; clipId: string };
// STU08: variants = other published versions testing the same hypothesis; window = the one age compared (fixed up front: no peeking at a kinder one).
export type Experiment = { id: string; hypothesis: string; lesson: string; jobId: string; clipId: string; at: string; variants?: Arm[]; window?: SnapKey };
export const WINDOWS: SnapKey[] = ["24h", "48h", "72h", "7d"];
export const VARIANTS_MAX = 3;
export type Version = { videoId: string; mediaHash: string; publishedAt?: string };
export type Verdict = "supported" | "not-supported" | "insufficient";
export type Result = { id: string; verdict: Verdict; key: string; vars: Record<string, string | number>; version?: Version; snap?: SnapKey;
  views?: number; baseline?: number; n?: number; ratio?: number; likeForLike?: boolean; forecast?: Forecast };

/** The exact version that went out: only a finished upload with the file's hash counts. */
export function versionOf(e: Experiment, jobs: Pick<ClipJob, "id" | "clips">[]): Version | null {
  const p = jobs.find((j) => j.id === e.jobId)?.clips.find((c) => c.id === e.clipId)?.publish;
  return p?.videoId && p.mediaHash && (p.status === "done" || p.status === "scheduled") ? { videoId: p.videoId, mediaHash: p.mediaHash, publishedAt: p.scheduledFor ?? p.at } : null;
}

/** Comparable Shorts with a reading at `snap`: same kind and length band when ≥ BASE_MIN exist (like-for-like), else any. */
export function baseline(target: LearnRec, recs: LearnRec[], snap: SnapKey): { views: number[]; likeForLike: boolean } {
  const t0 = Date.parse(target.publishedAt ?? "");
  const near = recs.filter((r) => r.videoId !== target.videoId && r.retryOf !== target.videoId && r.snaps[snap] &&
    Number.isFinite(t0) && Math.abs(Date.parse(r.publishedAt ?? "") - t0) <= BASE_DAYS * DAY);
  const like = near.filter((r) => r.kind === target.kind && lengthBand(r.durationSec) === lengthBand(target.durationSec));
  const use = like.length >= BASE_MIN ? like : near;
  return { views: use.map((r) => r.snaps[snap]!.views), likeForLike: use === like };
}

/** One experiment's verdict. supported: views ≥ WIN × the baseline median; not supported: ≤ the median; between, too young
 *  (no 48 h reading), unpublished or < BASE_MIN comparables: insufficient data. */
export function judge(e: Experiment, jobs: Pick<ClipJob, "id" | "clips">[], recs: LearnRec[]): Result {
  const version = versionOf(e, jobs);
  if (!version) return { id: e.id, verdict: "insufficient", key: "exp.notPublished", vars: {} };
  const rec = recs.find((r) => r.videoId === version.videoId);
  const snap = rec && (e.window ? (rec.snaps[e.window] ? e.window : undefined) : (["72h", "48h"] as const).find((k) => rec.snaps[k]));
  if (!rec || !snap) {
    const forecast = rec ? forecastShort(rec, recs.filter((r) => r.snaps["7d"])) ?? undefined : undefined;
    return { id: e.id, verdict: "insufficient", key: "exp.tooYoung", vars: {}, version, ...(forecast && { forecast }) };
  }
  const b = baseline(rec, recs, snap), views = rec.snaps[snap]!.views;
  if (b.views.length < BASE_MIN) return { id: e.id, verdict: "insufficient", key: "exp.fewBase", vars: { n: b.views.length, min: BASE_MIN }, version, snap, views, n: b.views.length };
  const base = median(b.views), ratio = Math.round((views / Math.max(1, base)) * 100) / 100;
  const verdict: Verdict = ratio >= WIN ? "supported" : ratio <= NOT_SUPPORTED ? "not-supported" : "insufficient";
  return { id: e.id, verdict, key: `exp.${verdict === "insufficient" ? "between" : verdict}`, vars: { ratio, snap, n: b.views.length, win: WIN },
    version, snap, views, baseline: base, n: b.views.length, ratio, likeForLike: b.likeForLike };
}

export type ArmResult = Arm & { version: Version | null; views?: number; readAt?: string };
export type Comparison = { window: SnapKey; arms: ArmResult[]; status: "waiting" | "differs" | "similar"; ratio?: number };
/** STU08: every arm (the main Short + its variants) at the same age. Waits until all have that reading; a gap ≥ WIN is "differs",
 *  anything smaller "similar". One comparison per arm is never proof, and it never predicts the next Short. */
export function compareArms(e: Experiment, jobs: Pick<ClipJob, "id" | "clips">[], recs: LearnRec[]): Comparison {
  const window = e.window ?? "72h";
  const arms = [{ jobId: e.jobId, clipId: e.clipId }, ...(e.variants ?? [])].map((a): ArmResult => {
    const version = versionOf({ ...e, ...a }, jobs), s = version && recs.find((r) => r.videoId === version.videoId)?.snaps[window];
    return { ...a, version, ...(s && { views: s.views, readAt: s.at }) };
  });
  const views = arms.map((a) => a.views);
  if (arms.length < 2 || views.some((v) => v === undefined)) return { window, arms, status: "waiting" };
  const ratio = Math.round((Math.max(...(views as number[])) / Math.max(1, Math.min(...(views as number[])))) * 100) / 100;
  return { window, arms, status: ratio >= WIN ? "differs" : "similar", ratio };
}

/** Failed experiments are evidence too: a not-supported one can't be deleted. */
export const removalProblem = (r: Pick<Result, "verdict">): string => (r.verdict === "not-supported" ? "Failed experiments are kept: they are evidence too" : "");

/** A proposed lesson once ≥ LESSON_MIN experiments with the same lesson text are supported and supported ≥ 2 × not supported.
 *  Goes to lessons-pure reconcile as "proposed": never kept without his click. */
export function lessonsFrom(exps: Experiment[], results: Result[], now: number): Lesson[] {
  const groups = new Map<string, { text: string; ok: Result[]; no: number }>();
  for (const e of exps) {
    const r = results.find((x) => x.id === e.id), k = normText(e.lesson);
    if (!r || !k) continue;
    const g = groups.get(k) ?? { text: e.lesson.trim(), ok: [], no: 0 };
    if (r.verdict === "supported") g.ok.push(r); else if (r.verdict === "not-supported") g.no++;
    groups.set(k, g);
  }
  return [...groups].filter(([, g]) => g.ok.length >= LESSON_MIN && g.ok.length >= 2 * g.no).map(([k, g]) => ({
    id: `exp:${k.replace(/ /g, "-").slice(0, 60)}`, text: g.text.slice(0, 180), planet: "studio", area: "clip.experiment", key: k, sign: 1, tags: ["shorts", "experiment"],
    support: g.ok.length + g.no, confidence: Math.round((g.ok.length / (g.ok.length + g.no)) * 100) / 100,
    evidence: g.ok.map((r) => r.version!.videoId).slice(0, 8), at: new Date(now).toISOString() }));
}

// ---- store (<studio>/experiments.json; I/O in experiments.ts) ----
export const EXP_MAX = 100, TEXT_MAX = 180;
export type ExpState = { v: 1; items: Experiment[] };
export const emptyExperiments = (): ExpState => ({ v: 1, items: [] });
const isStr = (x: unknown): x is string => typeof x === "string";
const clean = (x: unknown) => (isStr(x) ? x.replace(/[<>\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim() : "");
export const experimentsProblem = (x: unknown): string => {
  const s = x as ExpState;
  return s && s.v === 1 && Array.isArray(s.items) && s.items.every((e) => e && [e.id, e.hypothesis, e.lesson, e.jobId, e.clipId, e.at].every(isStr)
    && (e.window === undefined || WINDOWS.includes(e.window)) && (e.variants === undefined || (Array.isArray(e.variants) && e.variants.every((a) => a && isStr(a.jobId) && isStr(a.clipId)))))
    ? "" : "not an experiments file";
};

/** His "add experiment" → the new state, or a message for a 400. Only a published clip with a media hash can be tested. */
export function addExperiment(s: ExpState, b: Record<string, unknown>, jobs: Pick<ClipJob, "id" | "clips">[], id: string, at: string): ExpState | string {
  const hypothesis = clean(b.hypothesis), lesson = clean(b.lesson);
  if (!hypothesis || hypothesis.length > TEXT_MAX || !lesson || lesson.length > TEXT_MAX) return `hypothesis and lesson must be 1-${TEXT_MAX} characters`;
  if (!isStr(b.jobId) || !isStr(b.clipId)) return "jobId and clipId required";
  if (b.window !== undefined && !WINDOWS.includes(b.window as SnapKey)) return `window must be one of ${WINDOWS.join(", ")}`;
  const raw = b.variants ?? [];
  if (!Array.isArray(raw) || raw.length > VARIANTS_MAX || !raw.every((a) => a && isStr(a.jobId) && isStr(a.clipId))) return `variants: up to ${VARIANTS_MAX} published clips`;
  const variants: Arm[] = raw.map((a) => ({ jobId: a.jobId, clipId: a.clipId }));
  const e: Experiment = { id, hypothesis, lesson, jobId: b.jobId, clipId: b.clipId, at, ...(variants.length && { variants }), ...(b.window !== undefined && { window: b.window as SnapKey }) };
  const keys = [e, ...variants].map((a) => `${a.jobId}/${a.clipId}`);
  if (new Set(keys).size !== keys.length) return "Each variant must be a different Short";
  if (![e, ...variants].every((a) => versionOf({ ...e, ...a }, jobs))) return "Only a published clip (with its media hash) can be an experiment";
  if (s.items.some((x) => x.jobId === e.jobId && x.clipId === e.clipId)) return "This Short already has an experiment";
  return { v: 1, items: [e, ...s.items].slice(0, EXP_MAX) };
}
