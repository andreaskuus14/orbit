import path from "node:path";
import { checkTools, createJob, getJob, listDownloads, listInbox, listJobs, readState, saveState, studioRoot, updateClip, withJobLock } from "./clips/factory";
import { scheduleAll } from "./clips/publish-schedule";
import { isInboxName, validOptions } from "./clips/pure";
import { YT_UPLOAD_SCOPE, hasScopes } from "./yt-analytics-pure";
import { readStored } from "./yt-oauth";
import { cancelPlan, confirmStep, emptyPlans, isActive, nextMove, pickBest, plansProblem, validatePlan, type Plan, type PlanStep, type PlansState } from "./plans-pure";

// CORE plan runner: one plan at a time, state in <studio>/plans.json (survives restarts; resumed from the scout timer).
// Steps call the same STUDIO functions the UI routes use. A schedule step only runs after the owner's OK (plans-pure confirmStep).

const file = () => path.join(studioRoot(), "plans.json");
const g = globalThis as unknown as { __orbitPlans?: { lock: Promise<unknown>; running: Set<string> } };
const S = (g.__orbitPlans ??= { lock: Promise.resolve(), running: new Set() });
const load = async () => (await readState<PlansState>(studioRoot(), "plans", plansProblem)) ?? emptyPlans();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function update<T>(fn: (s: PlansState) => T): Promise<T> {
  const p = S.lock.then(async () => { const s = await load(); const r = fn(s); await saveState("plans", file(), s); return r; });
  S.lock = p.catch(() => {});
  return p;
}
const get = async (id: string) => (await S.lock.then(load)).plans.find((p) => p.id === id) ?? null;
const patch = (id: string, fn: (p: Plan) => void) => update((s) => { const p = s.plans.find((x) => x.id === id); if (p) { fn(p); p.updatedAt = new Date().toISOString(); } });

export const currentPlan = async () => (await S.lock.then(load)).plans[0] ?? null;

/** CORE's plan_task: validated steps → a new running plan, or a message. */
export async function createPlan(input: unknown): Promise<Plan | string> {
  const v = validatePlan(input);
  if (typeof v === "string") return v;
  const p = await update((s): Plan | string => {
    if (s.plans.some(isActive)) return "Another plan is still running; cancel it in CORE first";
    const now = new Date().toISOString();
    const plan: Plan = { id: `plan-${Date.now().toString(36)}`, goal: v.goal, createdAt: now, updatedAt: now, status: "running", current: 0, steps: v.steps };
    s.plans = [plan, ...s.plans].slice(0, 10);
    return plan;
  });
  if (typeof p !== "string") void drive(p.id);
  return p;
}

/** The owner's clicks in CorePanel: OK for the step the plan waits on, or cancel. Returns "" or why not. */
export async function planAction(id: string, op: "confirm" | "cancel", step: number): Promise<string> {
  const err = await update((s) => { const p = s.plans.find((x) => x.id === id); if (!p) return "Plan not found"; const e = op === "confirm" ? confirmStep(p, step) : cancelPlan(p); if (!e) p.updatedAt = new Date().toISOString(); return e; });
  if (!err && op === "confirm") void drive(id);
  return err;
}

/** After a restart: continue running plans (waiting ones stay paused for the OK). */
export async function resumePlans() {
  for (const p of (await S.lock.then(load)).plans) if (p.status === "running" && !S.running.has(p.id)) void drive(p.id);
}

async function drive(id: string) {
  if (S.running.has(id)) return;
  S.running.add(id);
  try {
    for (;;) {
      const p = await get(id);
      if (!p) return;
      const move = nextMove(p);
      if (move === "stop") return;
      if (move === "finish") return void (await patch(id, (q) => { if (isActive(q)) q.status = "done"; }));
      if (move === "wait_ok") return void (await patch(id, (q) => { if (q.status === "running") q.status = "waiting"; }));
      const at = p.current;
      await patch(id, (q) => { q.steps[at].status = "running"; });
      try {
        const note = await runStep(id, p, p.steps[at]);
        await patch(id, (q) => { q.steps[at].status = "done"; q.steps[at].note = note; if (isActive(q) && q.current === at) q.current++; });
      } catch (e) {
        await patch(id, (q) => { q.steps[at].status = "failed"; q.steps[at].note = msg(e); if (isActive(q)) { q.status = "failed"; q.error = msg(e); } });
        return;
      }
    }
  } catch (e) {
    console.error("[orbit] plan runner failed:", msg(e));
  } finally {
    S.running.delete(id);
  }
}

const stillActive = async (id: string) => { const p = await get(id); return !!p && isActive(p); };

async function runStep(id: string, p: Plan, step: PlanStep): Promise<string> {
  switch (step.type) {
    case "clip": {
      if (p.jobId) return "job already started"; // resumed after a restart
      const [jobs, downloads] = await Promise.all([listJobs(), listDownloads().catch(() => [])]);
      const inbox = await listInbox(jobs, downloads);
      // "latest" = the newest inbox file only (never an older one). The chosen name is saved before createJob, so a restart in between
      // re-finds the same file and its job (created after the plan started) instead of picking another file or clipping twice.
      const f = step.args.source === "latest" ? inbox[0] : inbox.find((x) => x.name === step.args.source);
      if (!f || !isInboxName(f.name)) throw new Error(step.args.source === "latest" ? "No video in the inbox to clip" : `${step.args.source} isn't in the inbox`);
      const existing = jobs.find((j) => j.source === f.name && j.status !== "failed"); // jobs are newest first
      if (existing) {
        if (step.args.source !== "latest" && Date.parse(existing.createdAt) < Date.parse(p.createdAt)) throw new Error(`${f.name} already has a clip job`);
        await patch(id, (q) => { q.jobId = existing.id; q.steps[p.current].args.source = f.name; });
        return `using the clip job already started for ${f.name}`;
      }
      await patch(id, (q) => { q.steps[p.current].args.source = f.name; });
      if (!(await checkTools()).ffmpeg) throw new Error("ffmpeg is missing (see the ORBIT doctor)");
      const opts = validOptions({ count: step.args.count, ...(step.args.maxSec ? { maxSec: step.args.maxSec } : {}), ...(step.args.layout ? { layout: step.args.layout } : {}) });
      if (typeof opts === "string") throw new Error(opts);
      const job = await createJob(f.name, opts);
      await patch(id, (q) => { q.jobId = job.id; });
      return `started a job for ${f.name}`;
    }
    case "wait": {
      for (;;) {
        const job = p.jobId ? await getJob(p.jobId) : null;
        if (!job) throw new Error("The clip job is gone");
        if (job.status === "done") return `${job.clips.filter((c) => c.status === "ready").length} clips ready`;
        if (job.status === "failed") throw new Error(`The clip job failed: ${job.error ?? "unknown error"}`);
        await patch(id, (q) => { q.progress = job.progress; });
        if (!(await stillActive(id))) return "cancelled";
        await sleep(5000);
      }
    }
    case "pick_best": {
      const job = p.jobId ? await getJob(p.jobId) : null;
      const ids = job ? pickBest(job.clips, step.args.n ?? 3) : [];
      if (!ids.length) throw new Error("No ready clips to pick from");
      await patch(id, (q) => { q.picked = ids; });
      return `picked ${ids.length}: ${ids.map((c) => job!.clips.find((x) => x.id === c)!.title).join(" · ").slice(0, 200)}`;
    }
    case "approve": {
      const picked = p.picked ?? [];
      return withJobLock(async () => {
        const job = p.jobId ? await getJob(p.jobId) : null;
        if (!job) throw new Error("The clip job is gone");
        let k = 0;
        for (const c of job.clips) if (picked.includes(c.id) && c.status === "ready") { await updateClip(job, c, { status: "approved" }); k++; }
        return `approved ${k}`;
      });
    }
    case "schedule": {
      if (!step.confirmed) throw new Error("Scheduling needs your OK"); // belt and braces: nextMove already pauses here
      const s = await readStored();
      if (!s) throw new Error("Connect YouTube first");
      if (!hasScopes(s.scope, [YT_UPLOAD_SCOPE])) throw new Error("Reconnect YouTube to allow uploads");
      const b = await scheduleAll((p.picked ?? []).map((c) => `${p.jobId}/${c}`));
      if (typeof b === "string") {
        // Resumed after a restart: the picks may already be on YouTube with a schedule.
        const job = /No approved, unpublished/.test(b) && p.jobId ? await getJob(p.jobId) : null;
        const picked = job?.clips.filter((c) => p.picked?.includes(c.id)) ?? [];
        if (picked.length && picked.every((c) => c.publish?.status === "scheduled" || c.publish?.status === "done")) return `already scheduled ${picked.length}`;
        throw new Error(b);
      }
      while (b.running) await sleep(3000); // our own batch; uploads go one at a time and cancelling the plan doesn't stop one mid-way
      if (b.error) throw new Error(b.error);
      return `scheduled ${b.scheduled} of ${b.total}`;
    }
  }
}
