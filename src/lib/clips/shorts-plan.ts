import path from "node:path";
import { contentHash, spendContent } from "../approval-pure";
import { listJobs, readState, saveState, studioRoot } from "./factory";
import { approveStory, getStory, listStories, quoteStory, runningStory, weekUsage, writeStory } from "./story";
import { DRAMA_DEFAULT, approveProblem, fingerprint, payable, quoteTotal, validStoryOpts, type StoryJob } from "./story-pure";
import { capProblem, weekStart } from "../higgsfield-pure";
import { validTarget, weekProgress, type PJob } from "./pipeline-pure";
import { stopAllOn } from "../stop-all";
import { PAUSED_MSG } from "../stop-all-pure";
import {
  batchProblem, emptyPlan, ideaCands, inFlight, morningBatch, nightTodo, pickIdeas, planProblem, rollWeek, trendCands, weekNeed,
  type Batch, type Cand, type ShortsPlan, type StoryState,
} from "./shorts-plan-pure";

// Shorts autopilot v2 (roadmap B4). State: <studio>/shorts-plan.json. Logic: shorts-plan-pure.ts. Runs from the night shift's
// "clips" slot (night.ts) or the board's "Plan now"; writes scripts and asks Higgsfield prices (get_cost only). Spending starts only
// from approveBatch, the owner's one click on the exact batch and total, and each story still passes approveStory's own checks.

const ID = "shorts-plan";
const save = (p: ShortsPlan) => saveState(ID, path.join(studioRoot(), `${ID}.json`), p);
const G = globalThis as unknown as { __orbitShortsBatch?: { ids: string[]; done: string[]; errors: string[] }; __orbitShortsPrep?: boolean };

const stateOf = (j: StoryJob): StoryState => {
  const credits = quoteTotal(j.items);
  const quoted = !!j.quote && j.quote.fingerprint === fingerprint(j.story, j.opts) && payable(j.items).every((i) => typeof i.credits === "number");
  return { id: j.id, status: j.status, quoted, credits, ok: approveProblem(j, credits) === "", madeAny: j.items.some((i) => !!i.jobId) };
};

async function current() {
  const now = Date.now(), stories = await listStories(), states = stories.map(stateOf);
  const live = states.filter((s) => s.status !== "done" && s.status !== "failed").map((s) => s.id);
  const raw = (await readState<ShortsPlan>(studioRoot(), ID, planProblem)) ?? emptyPlan(weekStart(now));
  const plan = rollWeek(raw, weekStart(now), live);
  plan.picks = plan.picks.filter((p) => !p.story || states.some((s) => s.id === p.story)); // he deleted the story: drop the pick
  const w = await weekUsage();
  const titles = Object.fromEntries(stories.map((s) => [s.id, s.story.title]));
  return { now, stories, states, plan, w, batch: morningBatch(plan, states, titles, w.used, w.cap) };
}

async function candidates(userId?: string): Promise<Cand[]> {
  const [ideas, trends] = await Promise.all([
    import("../ideas").then((m) => m.listIdeas()).then((r) => ideaCands(r.shown), () => []),
    import("../devtools").then((m) => m.getTrends(Date.now(), "scout")).then((t) => trendCands({ risers: t.risers, topics: t.yt?.topics }), () => []),
  ]);
  const all = [...ideas, ...trends];
  if (!userId) return all;
  // Kept lessons nudge each source up or down (e.g. "comment ideas do well") the way they nudge the morning brief.
  const nudged = await import("../lessons").then((m) => m.morningPrior(userId, all.map((c) => ({ ...c, base: c.score, kind: "clips" }))), () => null);
  return nudged ? nudged.map((x): Cand => ({ key: x.key, source: x.source, title: x.title, idea: x.idea, score: x.base })) : all;
}

/** Plan the week, write tonight's scripts and get prices. Never approves anything. */
export async function prepShorts(userId?: string, signal?: AbortSignal): Promise<{ picked: number; wrote: number; quoted: number; batch: Batch }> {
  if (G.__orbitShortsPrep) return { picked: 0, wrote: 0, quoted: 0, batch: (await current()).batch };
  G.__orbitShortsPrep = true;
  try { return await prep(userId, signal); } finally { G.__orbitShortsPrep = false; }
}

async function prep(userId?: string, signal?: AbortSignal) {
  const c = await current(), { plan } = c;
  const prog = weekProgress((await listJobs()) as unknown as PJob[], c.now, plan.target);
  const need = weekNeed({ target: plan.target, booked: prog.booked, ready: prog.ready, inFlight: inFlight(plan, c.states) });
  const fresh = need ? pickIdeas(await candidates(userId), need, plan.used, c.stories.map((s) => s.opts.idea), plan.picks) : [];
  const at = new Date().toISOString();
  plan.picks.push(...fresh.map((x) => ({ ...x, at })));
  plan.used.push(...fresh.map((x) => x.key));
  await save(plan);
  const todo = nightTodo(plan, c.states);
  let wrote = 0, quoted = 0;
  for (const p of todo.write) {
    if (signal?.aborted || stopAllOn()) break;
    const o = validStoryOpts({ idea: p.idea, format: "drama", model: DRAMA_DEFAULT });
    if (typeof o === "string") continue;
    try {
      const job = await writeStory(o, signal);
      p.story = job.id; wrote++;
      await save(plan);
      todo.quote.push(job.id);
    } catch (e) { console.error(`[orbit] shorts autopilot: script for "${p.title}" failed: ${e instanceof Error ? e.message : e}`); }
  }
  for (const id of todo.quote) {
    if (signal?.aborted || stopAllOn()) break;
    const job = await getStory(id);
    if (job && !(await quoteStory(job, signal)).error) quoted++;
  }
  return { picked: fresh.length, wrote, quoted, batch: (await current()).batch };
}

/** What the Shorts board shows: the week's picks and the one morning batch. */
export async function shortsPlanView() {
  const c = await current(), by = new Map(c.stories.map((s) => [s.id, s]));
  const prog = weekProgress((await listJobs()) as unknown as PJob[], c.now, c.plan.target);
  return {
    target: c.plan.target, booked: prog.booked, ready: prog.ready,
    need: weekNeed({ target: c.plan.target, booked: prog.booked, ready: prog.ready, inFlight: inFlight(c.plan, c.states) }),
    picks: c.plan.picks.map((p) => { const s = p.story ? by.get(p.story) : undefined; return { key: p.key, source: p.source, title: s?.story.title || p.title, story: p.story ?? null, status: s?.status ?? "idea", step: s?.step ?? "Script tonight" }; }),
    batch: c.batch, week: c.w, running: G.__orbitShortsBatch ?? null, planning: !!G.__orbitShortsPrep,
  };
}

export async function setShortsTarget(t: unknown) {
  const c = await current();
  c.plan.target = validTarget(t);
  await save(c.plan);
}

/** The owner's one click: approves exactly the batch shown, then makes the stories one after another (one spend at a time). */
export async function approveBatch(ids: unknown, credits: unknown): Promise<Batch | string> {
  if (G.__orbitShortsBatch) return "A batch is already being made";
  if (stopAllOn()) return PAUSED_MSG;
  const run = (G.__orbitShortsBatch = { ids: [] as string[], done: [] as string[], errors: [] as string[] }); // claimed before any await: a double click can't start two runs
  const refuse = (why: string) => { if (G.__orbitShortsBatch === run) G.__orbitShortsBatch = undefined; return why; };
  let c: Awaited<ReturnType<typeof current>>;
  // His click approves the batch as it is now: each story's quote is hashed here, so a story changed later needs a fresh approval.
  const seen = new Map<string, string>();
  try {
    const off = (await import("../autonomy")).allows("higgsfield-spend", "owner");
    if (!off.ok) return refuse(off.why);
    c = await current();
    const why = batchProblem(c.batch, ids, credits) || capProblem(c.w.used, c.batch.credits, c.w.cap);
    if (why) return refuse(why);
    for (const it of c.batch.items) { const j = await getStory(it.id); if (j?.quote) seen.set(it.id, await contentHash(spendContent(j.quote.fingerprint, it.credits))); }
  } catch (e) { refuse(""); throw e; }
  run.ids = c.batch.items.map((i) => i.id);
  void (async () => {
    for (const it of c.batch.items) {
      if (!(await idle(() => runningStory() === null))) { run.errors.push(`${it.title}: another story kept running`); continue; }
      const job = await getStory(it.id);
      const r = job ? await approveStory(job, it.credits, seen.get(it.id)) : "Story not found"; // re-checks quote, cap, Stop-all and Autonomy per story
      if (typeof r === "string") { run.errors.push(`${it.title}: ${r}`); continue; }
      await idle(() => runningStory() !== it.id);
      const after = await getStory(it.id);
      if (after?.status === "draft") await quoteStory(after).catch(() => {}); // drama: characters made → price the shots for the next batch
      run.done.push(it.id);
    }
  })().catch((e) => console.error("[orbit] shorts batch:", e)).finally(() => { if (G.__orbitShortsBatch === run) G.__orbitShortsBatch = undefined; });
  return c.batch;
}

// shortcut: polls every 5 s for up to 2 h per story; fine for a handful of Shorts a day.
async function idle(ok: () => boolean): Promise<boolean> {
  for (let t = 0; t < 1440; t++) { if (ok()) return true; await new Promise((r) => setTimeout(r, 5000)); }
  return ok();
}
