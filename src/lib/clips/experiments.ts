import { randomBytes } from "node:crypto";
import path from "node:path";
import { listJobs, readState, saveState, studioRoot } from "./factory";
import { emptyLearn, learnProblem, type LearnState } from "./learn-pure";
import { addExperiment, emptyExperiments, experimentsProblem, judge, lessonsFrom, versionOf, type ExpState, type Experiment, type Result } from "./experiments-pure";

// Shorts experiments (STUDIO Stats): <studio>/experiments.json. Reads learn.json and the clip jobs; never touches YouTube.

const file = () => path.join(studioRoot(), "experiments.json");
const g = globalThis as unknown as { __orbitExp?: Promise<unknown> };
const load = async () => (await readState<ExpState>(studioRoot(), "experiments", experimentsProblem)) ?? emptyExperiments();
const recs = async () => Object.values(((await readState<LearnState>(studioRoot(), "learn", learnProblem)) ?? emptyLearn()).clips);

/** Serialised read-modify-write; `fn` returns the new state or a message. */
function update(fn: (s: ExpState) => Promise<ExpState | string>): Promise<ExpState | string> {
  const p = (g.__orbitExp ?? Promise.resolve()).then(async () => { const r = await fn(await load()); if (typeof r !== "string") await saveState("experiments", file(), r); return r; });
  g.__orbitExp = p.catch(() => {});
  return p;
}

export type ExperimentsView = { items: (Experiment & Result & { title: string })[]; clips: { jobId: string; clipId: string; title: string }[] };

export async function experimentsView(): Promise<ExperimentsView> {
  const [s, jobs, rs] = await Promise.all([load(), listJobs(), recs()]);
  const title = (e: Pick<Experiment, "jobId" | "clipId">) => jobs.find((j) => j.id === e.jobId)?.clips.find((c) => c.id === e.clipId)?.title ?? "";
  const used = new Set(s.items.map((e) => `${e.jobId}/${e.clipId}`));
  const clips = jobs.flatMap((j) => j.clips.filter((c) => !used.has(`${j.id}/${c.id}`) && versionOf({ jobId: j.id, clipId: c.id } as Experiment, [j]))
    .map((c) => ({ jobId: j.id, clipId: c.id, title: c.title }))).slice(0, 50);
  return { items: s.items.map((e) => ({ ...e, ...judge(e, jobs, rs), title: title(e) })), clips };
}

export const addExp = async (b: Record<string, unknown>) => { const jobs = await listJobs(); return update(async (s) => addExperiment(s, b, jobs, randomBytes(6).toString("hex"), new Date().toISOString())); };
export const removeExp = (id: string) => update(async (s) => (s.items.some((e) => e.id === id) ? { v: 1, items: s.items.filter((e) => e.id !== id) } : "Experiment not found"));

/** Proposed lessons from experiments, for the nightly lessons reconcile (lessons.ts). */
export async function experimentLessons(now: number) {
  const [s, jobs, rs] = await Promise.all([load(), listJobs(), recs()]);
  return lessonsFrom(s.items, s.items.map((e) => judge(e, jobs, rs)), now);
}
