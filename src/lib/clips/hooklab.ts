import path from "node:path";
import { listJobs, readState, saveJob, saveState, startVersion, studioRoot } from "./factory";
import { baseEdit, type Analysis } from "./pure";
import { emptyLearn, learnProblem, type LearnState } from "./learn-pure";
import { emptyHookLab, hookLabPlan, hookLabProblem, hookPrior, LABEL, labOutcomes, PATTERNS, rankHookLab, recordOutcomes, type HookLabState } from "./hooklab-pure";
import type { Clip, ClipJob } from "./types";

// Hook lab: <studio>/hooklab.json holds which opening pattern won once a published variant has its 48 h result.

const file = () => path.join(studioRoot(), "hooklab.json");
const loadLab = async () => (await readState<HookLabState>(studioRoot(), "hooklab", hookLabProblem)) ?? emptyHookLab();
const loadLearn = async () => (await readState<LearnState>(studioRoot(), "learn", learnProblem)) ?? emptyLearn();

/** Call under withJobLock after the version route's checks. Renders A/B/C as ordinary versions; returns them or a message for a 409. */
export async function startHookLab(job: ClipJob, base: Clip, a: Analysis): Promise<Clip[] | string> {
  if (job.clips.some((c) => c.hookLab?.of === base.id)) return "This clip already has a hook lab";
  const out: Clip[] = [], at = new Date().toISOString();
  for (const { pattern, req } of hookLabPlan(base, a)) {
    const c = await startVersion(job, base, req, a);
    if (typeof c === "string") { if (!out.length) return c; break; }
    c.hookLab = { of: base.id, label: LABEL[pattern], pattern, at };
    out.push(c);
  }
  await saveJob(job); // the render chain's finish re-reads the job under the same lock, so the labels are on disk first
  return out;
}

/** The rendered variants ranked by the pure scorer, plus how many are still rendering. */
export async function hookLabView(job: ClipJob, baseId: string, a: Analysis) {
  const vs = job.clips.filter((c) => c.hookLab?.of === baseId && PATTERNS.includes(c.hookLab.pattern));
  const done = vs.filter((c) => c.status === "ready" || c.status === "approved");
  const r = rankHookLab(done.map((c) => ({ id: c.id, label: c.hookLab!.label, pattern: c.hookLab!.pattern, hook: c.hook, start: c.start, end: c.end, edit: c.edit ?? baseEdit(job.options) })),
    a, hookPrior(Object.values((await loadLearn()).clips)), await loadLab());
  return { ...r, pending: vs.filter((c) => c.status === "rendering").length, total: vs.length };
}

/** Results loop: published variants with a 48 h verdict feed the pattern prior (each video once). */
export async function recordHookLabs() {
  const s = await loadLab(), next = recordOutcomes(s, labOutcomes(await listJobs(), Object.values((await loadLearn()).clips)));
  if (next !== s) await saveState("hooklab", file(), next);
}
