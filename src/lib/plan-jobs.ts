// Plan-file jobs, IO side (rules: plan-jobs-pure.ts). One file per job: <ORBIT data dir>/plan-jobs/<id>.json (plan + progress, local).
// tickPlanJobs runs from the scheduler (after its Stop-all check): per active job, under a lease, it either checks the running step's
// task or starts the next step as a queued agent task (job-log effect step, so a restart never queues it twice). kickQueue runs it.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { jobEffect, releaseLease, takeLease } from "./job-log";
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
