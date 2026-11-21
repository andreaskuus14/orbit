// Shorts experiment loop (pure, tested in tests/experiments.test.ts): one hypothesis → the exact published version (video id +
// sha256 of the uploaded file, from clip.publish) → its views vs comparable Shorts at the same age. One Short is never proof:
// a verdict says "consistent with". Every experiment with the same lesson feeds one honest sequential test (abtest-pure: anytime-
// valid, ≤ 5 % false lessons however often he looks, never from fewer than 5 Shorts). A lesson is only proposed once that test
// is sure, through the lessons acceptance flow (lessons-pure reconcile → he keeps or rejects). Reuses learn-pure, forecast-pure.
import { lengthBand, median, WIN, type LearnRec, type SnapKey } from "./learn-pure.ts";
import { forecastShort, type Forecast } from "./forecast-pure.ts";
import { normText, type Lesson } from "../lessons-pure.ts";
import { LOG_OPTS, decide, logSpread, pooledSteps, type Decision, type SpreadObs } from "../abtest-pure.ts";
import type { ClipJob } from "./types.ts";

export const BASE_MIN = 5; // comparable Shorts a verdict needs
export const BASE_DAYS = 90; // comparables published within this many days of the experiment
export const NOT_SUPPORTED = 1; // at or under the baseline median
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
export type Comparison = { window: SnapKey; arms: ArmResult[]; status: "waiting" | "read"; ratio?: number };
/** STU08: every arm (the main Short + its variants) at the same age. Waits until all have that reading, then shows the gap.
 *  One pair never names a winner: the pair goes into the lesson's sequential test (lessonTests) like any other Short. */
export function compareArms(e: Experiment, jobs: Pick<ClipJob, "id" | "clips">[], recs: LearnRec[]): Comparison {
  const window = e.window ?? "72h";
  const arms = [{ jobId: e.jobId, clipId: e.clipId }, ...(e.variants ?? [])].map((a): ArmResult => {
    const version = versionOf({ ...e, ...a }, jobs), s = version && recs.find((r) => r.videoId === version.videoId)?.snaps[window];
    return { ...a, version, ...(s && { views: s.views, readAt: s.at }) };
  });
  const views = arms.map((a) => a.views);
  if (arms.length < 2 || views.some((v) => v === undefined)) return { window, arms, status: "waiting" };
  const ratio = Math.round((Math.max(...(views as number[])) / Math.max(1, Math.min(...(views as number[])))) * 100) / 100;
  return { window, arms, status: "read", ratio };
}

// ---- the honest test per lesson ----
const lg = (v: number) => Math.log(Math.max(1, v));
export type Observation = SpreadObs & { id: string; at: string; videoIds: string[] };
/** What one experiment adds to its lesson's test, in log views (> 0 = the idea helped), or null while it can't add anything yet.
 *  With variants: main − mean of the variants at the fixed window (a pair: same moment, so most of the noise cancels).
 *  Alone: the Short − the mean of its comparable Shorts at the same age. Spread from those comparables.
 *  exclude: Shorts testing the same lesson; they are the idea, not the usual, so they never count as comparables. */
export function observation(e: Experiment, jobs: Pick<ClipJob, "id" | "clips">[], recs: LearnRec[], exclude = new Set<string>()): Observation | null {
  const usual = recs.filter((r) => !exclude.has(r.videoId));
  if (e.variants?.length) {
    const c = compareArms(e, jobs, recs), main = c.arms[0], rec = recs.find((r) => r.videoId === main.version?.videoId);
    if (c.status !== "read" || !rec) return null;
    const vs = c.arms.slice(1).map((a) => lg(a.views!)), sp = logSpread(baseline(rec, usual, c.window).views);
    return { id: e.id, at: c.arms.map((a) => a.readAt ?? "").sort().at(-1)!, videoIds: c.arms.map((a) => a.version!.videoId),
      x: lg(main.views!) - vs.reduce((a, b) => a + b, 0) / vs.length, ss: sp?.ss ?? 0, df: sp?.df ?? 0, w: 1 + 1 / vs.length };
  }
  const r = judge(e, jobs, recs), rec = r.version && recs.find((x) => x.videoId === r.version!.videoId);
  if (!rec || !r.snap || r.views === undefined) return null;
  const sp = logSpread(baseline(rec, usual, r.snap).views);
  return sp && { id: e.id, at: rec.snaps[r.snap]!.at, videoIds: [rec.videoId], x: lg(r.views) - sp.mean, ss: sp.ss, df: sp.df, w: 1 + 1 / sp.n };
}

export type LessonTest = { key: string; text: string; decision: Decision; n: number; videoIds: string[] };
/** One sequential test per lesson (same text = same lesson), observations in the order their readings came in. */
export function lessonTests(exps: Experiment[], jobs: Pick<ClipJob, "id" | "clips">[], recs: LearnRec[]): Map<string, LessonTest> {
  const groups = new Map<string, { text: string; obs: Observation[] }>(), treated = new Map<string, Set<string>>();
  for (const e of exps) { // the main Shorts carry the idea (variants are the other side)
    const v = versionOf(e, jobs), k = normText(e.lesson);
    if (v && k) (treated.get(k) ?? treated.set(k, new Set()).get(k)!).add(v.videoId);
  }
  for (const e of exps) {
    const k = normText(e.lesson);
    if (!k) continue;
    const g = groups.get(k) ?? { text: e.lesson.trim(), obs: [] }, o = observation(e, jobs, recs, treated.get(k));
    if (o) g.obs.push(o);
    groups.set(k, g);
  }
  return new Map([...groups].map(([k, g]) => {
    const obs = g.obs.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return [k, { key: k, text: g.text, decision: decide(pooledSteps(obs), LOG_OPTS), n: obs.length, videoIds: obs.flatMap((o) => o.videoIds) }];
  }));
}

/** Failed experiments are evidence too: a not-supported one can't be deleted. */
export const removalProblem = (r: Pick<Result, "verdict">): string => (r.verdict === "not-supported" ? "Failed experiments are kept: they are evidence too" : "");

/** A proposed lesson once its sequential test says the idea is better (sure enough). Goes to lessons-pure reconcile as "proposed":
 *  never kept without his click. Not sure yet, no real difference or worse: no lesson. */
export function lessonsFrom(exps: Experiment[], jobs: Pick<ClipJob, "id" | "clips">[], recs: LearnRec[], now: number): Lesson[] {
  return [...lessonTests(exps, jobs, recs).values()].filter((t) => t.decision.verdict === "better").map((t) => ({
    id: `exp:${t.key.replace(/ /g, "-").slice(0, 60)}`, text: t.text.slice(0, 180), planet: "studio", area: "clip.experiment", key: t.key, sign: 1, tags: ["shorts", "experiment"],
    support: t.n, confidence: Math.round((1 - t.decision.p) * 100) / 100, evidence: t.videoIds.slice(0, 8), at: new Date(now).toISOString() }));
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
