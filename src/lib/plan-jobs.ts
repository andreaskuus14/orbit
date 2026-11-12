// Plan-file jobs, IO side (rules: plan-jobs-pure.ts). One file per job: <ORBIT data dir>/plan-jobs/<id>.json (plan + progress, local).
// tickPlanJobs runs from the scheduler (after its Stop-all check): per active job, under a lease, it either checks the running step's
// task or starts the next step as a queued agent task (job-log effect step, so a restart never queues it twice). kickQueue runs it.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { jobEffect, releaseLease, takeLease } from "./job-log";
import { stopAllOn } from "./stop-all";
import { cancelPlan, confirmStep, isActive, nextMove, pickBest, plansProblem, validatePlan, type Plan, type PlanStep, type PlansState } from "./plans-pure";
import { MAX_JOBS, applyTask, markStarted, newPlanJob, nextAction, parsePlanJob, retryFailed, stepRequest, type PlanJob } from "./plan-jobs-pure";

const dir = () => path.join(orbitDataDir(), "plan-jobs");
const file = (id: string) => path.join(dir(), `${id}.json`);

async function save(j: PlanJob) {
  await mkdir(dir(), { recursive: true });
  await writeFile(file(j.id) + ".tmp", JSON.stringify(j, null, 1));
  await rename(file(j.id) + ".tmp", file(j.id));
}
const load = async (id: string) => (/^[\w-]{1,64}$/.test(id) ? parsePlanJob(await readFile(file(id), "utf8").then((t) => JSON.parse(t), () => null)) : null);

export async function listPlanJobs(): Promise<PlanJob[]> {
  const names = await readdir(dir()).catch(() => [] as string[]);
  const jobs = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => load(n.slice(0, -5))));
  return jobs.filter((j): j is PlanJob => !!j).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createPlanJob(b: Record<string, unknown>): Promise<PlanJob | string> {
  if ((await listPlanJobs()).filter((j) => j.status !== "done").length >= MAX_JOBS) return `At most ${MAX_JOBS} open jobs: delete one first`;
  const j = newPlanJob(b, randomUUID(), Date.now());
  if (typeof j !== "string") await save(j);
  return j;
}

/** His buttons: pause | resume | retry | delete. "" = done, else the 400 message. Changes wait for a running tick (same lease). */
export async function patchPlanJob(id: string, action: unknown): Promise<string> {
  if (!(await takeLease(`plan-${id}`, 60_000))) return "The job is busy, try again in a moment";
  try {
    const j = await load(id);
    if (!j) return "Not found";
    if (action === "delete") { await unlink(file(id)); return ""; } // its tasks stay in OPERATIONS → Tasks
    if (action === "pause" && j.status === "active") j.status = "paused";
    else if (action === "resume" && j.status === "paused") j.status = "active";
    else if (action === "retry") { if (!retryFailed(j, Date.now())) return "No failed step to retry"; }
    else return "action must be pause, resume, retry or delete";
    await save(j);
    return "";
  } finally { await releaseLease(`plan-${id}`); }
}

/** Scheduler tick: one step's worth of work per job. Never throws. */
export async function tickPlanJobs(sb: SupabaseClient, userId: string) {
  try {
    const { usageHold } = await import("./usage-meter");
    for (const { id } of await listPlanJobs()) {
      if (!(await takeLease(`plan-${id}`, 5 * 60_000))) continue; // another runner (or his click) has it
      try {
        const j = await load(id), n = j && nextAction(j);
        if (!j || !n || n.act === "none") continue;
        if (n.act === "check") {
          if (!n.step.task) { n.step.status = "todo"; await save(j); continue; }
          const { data, error } = await sb.from("tasks").select("status, result, error").eq("id", n.step.task).maybeSingle();
          if (error) continue; // read failed: check again next tick
          applyTask(j, n.step.id, data, Date.now());
          await save(j);
          continue;
        }
        if (usageHold() || (j.night && !(await import("./night").then((m) => m.nightOwnsCompany())))) continue; // night jobs start steps in the night window only
        const step = n.step, i = j.steps.indexOf(step) + 1;
        const task = await jobEffect(`plan-${j.id}`, `step-${step.id}-${step.at ?? "new"}`, async (idem) => { // step.at: a Retry is a new attempt
          const had = await sb.from("tasks").select("id").eq("user_id", userId).like("request", `%[${idem}]`).limit(1);
          if (had.error) throw had.error;
          if (had.data?.length) return had.data[0].id as string;
          const { data, error } = await sb.from("tasks").insert({ user_id: userId, agent: j.agent, title: `📋 ${j.title} · ${i}/${j.steps.length}`.slice(0, 200), request: stepRequest(j, step, idem) }).select("id").single();
          if (error) throw error;
          return data.id as string;
        });
        markStarted(j, step.id, task, Date.now());
        await save(j);
        void import("./agents").then((a) => a.kickQueue(sb, userId));
      } finally { await releaseLease(`plan-${id}`); }
    }
  } catch (e) { console.error("[orbit] plan jobs:", e instanceof Error ? e.message : e); }
}

// STUDIO plans (CORE's plan_task; rules: plans-pure.ts) on the same runner: one file per plan, <plan-jobs>/studio-<id>.json, driven under the
// lease plan-studio-<id>. Who drives: his clicks and opening CORE (createStudioPlan / studioPlanAction / GET /api/plans), and the scheduler tick
// (tickStudioPlans: after its Stop-all check, only when Profile → Autonomy "Studio: prepare" allows background work). A schedule step only runs
// after his OK (plans-pure confirmStep). The old single <studio>/plans.json is read once and moved here (migrateStudioPlans).
type StudioStep = (id: string, p: Plan, step: PlanStep) => Promise<string | null>; // null: not finished yet, look again on the next drive
const sfile = (id: string) => path.join(dir(), `studio-${id}.json`);
const sg = globalThis as unknown as { __orbitStudioPlans?: { lock: Promise<unknown>; running: Set<string>; migrated?: boolean } };
const SP = (sg.__orbitStudioPlans ??= { lock: Promise.resolve(), running: new Set() });
const smsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseStudio = (x: unknown) => (!plansProblem({ v: 1, plans: [x] }) && /^[\w-]{1,64}$/.test((x as Plan).id) ? (x as Plan) : null);
async function saveStudio(p: Plan) {
  await mkdir(dir(), { recursive: true });
  await writeFile(sfile(p.id) + ".tmp", JSON.stringify(p, null, 1));
  await rename(sfile(p.id) + ".tmp", sfile(p.id));
}
const loadStudio = async (id: string) => parseStudio(await readFile(sfile(id), "utf8").then((t) => JSON.parse(t), () => null));

/** Old format → new: every plan in <studio>/plans.json becomes its own file (an existing new file wins), then plans.json → plans.json.migrated. */
export async function migrateStudioPlans() {
  const { readState, studioRoot } = await import("./clips/factory");
  const s = await readState<PlansState>(studioRoot(), "plans", plansProblem, true);
  if (s) {
    for (const p of s.plans) if (parseStudio(p) && !(await loadStudio(p.id))) await saveStudio(p);
    await rename(path.join(studioRoot(), "plans.json"), path.join(studioRoot(), "plans.json.migrated"));
  }
  SP.migrated = true;
}

/** Newest first. */
export async function listStudioPlans(): Promise<Plan[]> {
  if (!SP.migrated) await migrateStudioPlans().catch((e) => console.error("[orbit] studio plans migration:", smsg(e)));
  const names = (await readdir(dir()).catch(() => [] as string[])).filter((n) => n.startsWith("studio-") && n.endsWith(".json"));
  const ps = await Promise.all(names.map((n) => loadStudio(n.slice(7, -5))));
  return ps.filter((p): p is Plan => !!p).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function studioUpdate<T>(id: string, fn: (p: Plan) => T): Promise<T | null> {
  const r = SP.lock.then(async () => { const p = await loadStudio(id); if (!p) return null; const v = fn(p); p.updatedAt = new Date().toISOString(); await saveStudio(p); return v; });
  SP.lock = r.catch(() => {});
  return r;
}
const getStudio = (id: string) => SP.lock.then(() => loadStudio(id));

export const currentStudioPlan = async () => (await listStudioPlans())[0] ?? null;

/** CORE's plan_task: validated steps → a new running plan, or a message. */
export async function createStudioPlan(input: unknown): Promise<Plan | string> {
  const v = validatePlan(input);
  if (typeof v === "string") return v;
  const r = SP.lock.then(async (): Promise<Plan | string> => {
    const all = await listStudioPlans();
    if (all.some(isActive)) return "Another plan is still running; cancel it in CORE first";
    const now = new Date().toISOString();
    const plan: Plan = { id: `plan-${Date.now().toString(36)}`, goal: v.goal, createdAt: now, updatedAt: now, status: "running", current: 0, steps: v.steps };
    await saveStudio(plan);
    for (const old of all.slice(9)) await unlink(sfile(old.id)).catch(() => {}); // keep the newest 10
    return plan;
  });
  SP.lock = r.catch(() => {});
  const p = await r;
  if (typeof p !== "string") void driveStudioPlan(p.id);
  return p;
}

/** His clicks in CorePanel: OK for the step the plan waits on, or cancel. Returns "" or why not. */
export async function studioPlanAction(id: string, op: "confirm" | "cancel", step: number): Promise<string> {
  const err = (await studioUpdate(id, (p) => (op === "confirm" ? confirmStep(p, step) : cancelPlan(p)))) ?? "Plan not found";
  if (!err && op === "confirm") void driveStudioPlan(id);
  return err;
}

/** Owner lane (his click / CORE open): drive every running plan. Waiting ones stay paused for the OK. */
export async function resumeStudioPlans(steps: StudioStep = studioStep) {
  for (const p of await listStudioPlans()) if (p.status === "running") await driveStudioPlan(p.id, steps);
}

/** Scheduler tick (after its Stop-all check): background resume, only when Autonomy "Studio: prepare" allows it. Never throws. */
export async function tickStudioPlans(steps: StudioStep = studioStep) {
  try {
    if (!(await import("./autonomy")).allows("studio-prepare", "background").ok) return;
    await resumeStudioPlans(steps);
  } catch (e) { console.error("[orbit] studio plans:", smsg(e)); }
}

/** Runs steps until the plan waits, ends, or a step isn't finished yet. One driver per plan: in-process set + the job-log lease. */
export async function driveStudioPlan(id: string, steps: StudioStep = studioStep) {
  if (SP.running.has(id)) return;
  SP.running.add(id);
  try {
    if (!(await takeLease(`plan-studio-${id}`, 30 * 60_000))) return; // another process drives it (a schedule step can upload for a while)
    try {
      for (;;) {
        if (stopAllOn()) return; // Stop-all: stays "running" between steps; continues after Resume
        const p = await getStudio(id);
        if (!p) return;
        const move = nextMove(p);
        if (move === "stop") return;
        if (move === "finish") return void (await studioUpdate(id, (q) => { if (isActive(q)) q.status = "done"; }));
        if (move === "wait_ok") return void (await studioUpdate(id, (q) => { if (q.status === "running") q.status = "waiting"; }));
        const at = p.current;
        await studioUpdate(id, (q) => { q.steps[at].status = "running"; });
        let note: string | null;
        try { note = await steps(id, p, p.steps[at]); }
        catch (e) {
          await studioUpdate(id, (q) => { q.steps[at].status = "failed"; q.steps[at].note = smsg(e); if (isActive(q)) { q.status = "failed"; q.error = smsg(e); } });
          return;
        }
        if (note === null) return;
        await studioUpdate(id, (q) => { q.steps[at].status = "done"; q.steps[at].note = note; if (isActive(q) && q.current === at) q.current++; });
      }
    } finally { await releaseLease(`plan-studio-${id}`); }
  } catch (e) {
    console.error("[orbit] studio plan runner failed:", smsg(e));
  } finally {
    SP.running.delete(id);
  }
}

/** The real steps: the same STUDIO functions the UI routes use. */
const studioStep: StudioStep = async (id, p, step) => {
  const { checkTools, createJob, getJob, listDownloads, listInbox, listJobs, updateClip, withJobLock } = await import("./clips/factory");
  const patch = (fn: (q: Plan) => void) => studioUpdate(id, fn);
  switch (step.type) {
    case "clip": {
      if (p.jobId) return "job already started"; // resumed after a restart
      const { isInboxName, validOptions } = await import("./clips/pure");
      const [jobs, downloads] = await Promise.all([listJobs(), listDownloads().catch(() => [])]);
      const inbox = await listInbox(jobs, downloads);
      // "latest" = the newest inbox file only (never an older one). The chosen name is saved before createJob, so a restart in between
      // re-finds the same file and its job (created after the plan started) instead of picking another file or clipping twice.
      const f = step.args.source === "latest" ? inbox[0] : inbox.find((x) => x.name === step.args.source);
      if (!f || !isInboxName(f.name)) throw new Error(step.args.source === "latest" ? "No video in the inbox to clip" : `${step.args.source} isn't in the inbox`);
      const existing = jobs.find((j) => j.source === f.name && j.status !== "failed"); // jobs are newest first
      if (existing) {
        if (step.args.source !== "latest" && Date.parse(existing.createdAt) < Date.parse(p.createdAt)) throw new Error(`${f.name} already has a clip job`);
        await patch((q) => { q.jobId = existing.id; q.steps[p.current].args.source = f.name; });
        return `using the clip job already started for ${f.name}`;
      }
      await patch((q) => { q.steps[p.current].args.source = f.name; });
      if (!(await checkTools()).ffmpeg) throw new Error("ffmpeg is missing (see the ORBIT doctor)");
      const opts = validOptions({ count: step.args.count, ...(step.args.maxSec ? { maxSec: step.args.maxSec } : {}), ...(step.args.layout ? { layout: step.args.layout } : {}) });
      if (typeof opts === "string") throw new Error(opts);
      const job = await createJob(f.name, opts);
      await patch((q) => { q.jobId = job.id; });
      return `started a job for ${f.name}`;
    }
    case "wait": { // one look per drive: CorePanel polls every 4 s while a plan is active, the scheduler every minute
      const job = p.jobId ? await getJob(p.jobId) : null;
      if (!job) throw new Error("The clip job is gone");
      if (job.status === "done") return `${job.clips.filter((c) => c.status === "ready").length} clips ready`;
      if (job.status === "failed") throw new Error(`The clip job failed: ${job.error ?? "unknown error"}`);
      await patch((q) => { q.progress = job.progress; });
      return null;
    }
    case "pick_best": {
      const job = p.jobId ? await getJob(p.jobId) : null;
      const ids = job ? pickBest(job.clips, step.args.n ?? 3) : [];
      if (!ids.length) throw new Error("No ready clips to pick from");
      await patch((q) => { q.picked = ids; });
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
      const [{ scheduleAll }, { YT_UPLOAD_SCOPE, hasScopes }, { readStored }] = await Promise.all([import("./clips/publish-schedule"), import("./yt-analytics-pure"), import("./yt-oauth")]);
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
};
