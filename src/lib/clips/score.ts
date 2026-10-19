import { learnPrefs } from "./autopilot-pure";
import { readState, studioRoot } from "./factory";
import type { Hype } from "./hype-pure";
import { creatorOf, emptyLearn, learnProblem, type LearnState } from "./learn-pure";
import type { Word } from "./pure";
import { KEYS, MIN_FIT, PRIOR, confOf, features, modelFrom, scoreFrom, trainingRows, type FKey, type Model } from "./score-pure";
import type { Clip, ClipJob } from "./types";

// Personal virality score I/O: the model (priors, or learned from learn.json once ≥ MIN_FIT published Shorts have features) and
// scoring a finished job's clips. Pure logic: score-pure.ts.

const load = async () => (await readState<LearnState>(studioRoot(), "learn", learnProblem)) ?? emptyLearn();

/** Scores the job's clips in place (clip.virality). Throws only on a bug; the caller turns that into a warning. */
export async function scoreJobClips(job: ClipJob, o: { hype?: Hype; words: Word[]; peakAt: (c: Clip) => number }) {
  const s = await load(), recs = Object.values(s.clips);
  const model = modelFrom(recs), playbook = await import("./study").then((m) => m.playbook(), () => undefined);
  const prefs = learnPrefs(recs, "UTC", ""); // UTC: posting hour isn't a clip feature
  const recent = recs.filter((r) => r.publishedAt).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 20).map((r) => r.title);
  const creator = creatorOf(job.source);
  for (const c of job.clips) {
    const { x, d } = features(c, { hype: o.hype, words: o.words, creator, prefs, playbook, recent, peakAt: o.peakAt(c) });
    c.virality = scoreFrom(model, x, d);
  }
}

export type ModelStatus = { n: number; min: number; learned: boolean; conf: ReturnType<typeof confOf>; published: number; top: { key: FKey; w: number; prior: number }[] };

/** For "What ORBIT learned": how many Shorts the model learned from, and its strongest weights. */
export async function modelStatus(): Promise<ModelStatus> {
  const recs = Object.values((await load()).clips), m: Model = modelFrom(recs);
  return { n: trainingRows(recs).length, min: MIN_FIT, learned: m.learned, conf: confOf(m), published: recs.length,
    top: KEYS.map((key) => ({ key, w: m.w[key], prior: PRIOR[key] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)) };
}
