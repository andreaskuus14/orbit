// Plan-file protocol for long jobs (research 4.11): a job keeps its plan and progress in a local JSON file, does ONE step per session
// (each step is an ordinary queued agent task, so approvals, budgets, leases and recovery are the existing ones), and resumes exactly
// at the first unfinished step after a restart. Pure; tested in tests/plan-jobs.test.ts. IO: plan-jobs.ts; route: /api/plan-jobs;
// UI: OPERATIONS → Plans (PlanJobsView.tsx).

export type PJStepStatus = "todo" | "doing" | "done" | "failed";
export type PJStep = { id: string; text: string; status: PJStepStatus; task?: string; note?: string; at?: string };
export type PJStatus = "active" | "paused" | "done";
/** night: start steps only inside the night-shift window (steps already started finish whenever their task does). */
export type PlanJob = { id: string; title: string; agent: string; goal: string; night: boolean; status: PJStatus; createdAt: string; updatedAt: string; steps: PJStep[]; progress: string[] };

export const MAX_STEPS = 20, MAX_PROGRESS = 30, MAX_JOBS = 30;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");

/** POST body {title, agent, goal?, night?, steps: string[] | "one per line"} → a new job, or the 400 message. */
export function newPlanJob(b: Record<string, unknown>, id: string, now: number): PlanJob | string {
  const title = clean(b.title, 120), agent = clean(b.agent, 40).toLowerCase(), goal = clean(b.goal, 2000);
  const raw = Array.isArray(b.steps) ? b.steps : typeof b.steps === "string" ? b.steps.split(/\r?\n/) : [];
  const steps = raw.map((s) => clean(s, 300).replace(/^(?:\d+[.)]|[-*•])\s*/, "")).filter((s) => s.length >= 3);
  if (title.length < 3) return "Give the job a title";
  if (!/^[a-z0-9-]{2,40}$/.test(agent)) return "Unknown agent";
  if (!steps.length) return "Add at least one step (one per line)";
  if (steps.length > MAX_STEPS) return `At most ${MAX_STEPS} steps`;
  const at = new Date(now).toISOString();
  return { id, title, agent, goal, night: b.night === true, status: "active", createdAt: at, updatedAt: at, steps: steps.map((text, i) => ({ id: `s${i + 1}`, text, status: "todo" })), progress: [] };
}

/** Untrusted file → a job, or null. */
export function parsePlanJob(v: unknown): PlanJob | null {
  const j = v as Partial<PlanJob> | null;
  if (!j || typeof j.id !== "string" || !/^[\w-]{1,64}$/.test(j.id) || typeof j.title !== "string" || typeof j.agent !== "string" || !Array.isArray(j.steps)) return null;
  const steps = j.steps.filter((s): s is PJStep => !!s && typeof s.id === "string" && typeof s.text === "string" && ["todo", "doing", "done", "failed"].includes(s.status)).slice(0, MAX_STEPS);
  if (!steps.length) return null;
  return { id: j.id, title: j.title, agent: j.agent, goal: typeof j.goal === "string" ? j.goal : "", night: j.night === true, status: j.status === "paused" || j.status === "done" ? j.status : "active",
    createdAt: String(j.createdAt ?? ""), updatedAt: String(j.updatedAt ?? ""), steps, progress: Array.isArray(j.progress) ? j.progress.filter((p) => typeof p === "string").slice(-MAX_PROGRESS) : [] };
}

/** The one thing to do for this job now: start the next step, check the running one, or nothing (paused, done, or a failed step
 *  waiting for his Retry). A job never has two steps in flight. */
export function nextAction(j: PlanJob): { act: "start" | "check"; step: PJStep } | { act: "none" } {
  if (j.status !== "active") return { act: "none" };
  const s = j.steps.find((x) => x.status !== "done");
  if (!s || s.status === "failed") return { act: "none" };
  return { act: s.status === "doing" ? "check" : "start", step: s };
}

const line = (now: number, t: string) => `${new Date(now).toISOString().slice(0, 16).replace("T", " ")} ${t}`.slice(0, 300);
const log = (j: PlanJob, now: number, t: string) => { j.progress = [...j.progress, line(now, t)].slice(-MAX_PROGRESS); j.updatedAt = new Date(now).toISOString(); };

/** Step started as agent task `task` (mutates). */
export function markStarted(j: PlanJob, stepId: string, task: string, now: number) {
  const s = j.steps.find((x) => x.id === stepId);
  if (!s) return;
  Object.assign(s, { status: "doing", task, at: new Date(now).toISOString() });
  log(j, now, `Step ${j.steps.indexOf(s) + 1} started`);
}

/** The agent's "PROGRESS: …" line from its result, else the result's first line. */
export const progressLine = (result: string | null | undefined) => {
  const r = String(result ?? "");
  return (r.match(/^\s*PROGRESS:\s*(.+)$/im)?.[1] ?? r.split("\n").find((l) => l.trim()) ?? "").replace(/[*#`]/g, "").trim().slice(0, 200);
};

/** Apply the step task's row (mutates). awaiting_approval / queued / running: still in flight. A failed or cancelled task fails the
 *  step and pauses the job until he presses Retry; a missing row counts as failed. The last done step finishes the job. */
export function applyTask(j: PlanJob, stepId: string, t: { status: string; result?: string | null; error?: string | null } | null, now: number) {
  const s = j.steps.find((x) => x.id === stepId), n = s ? j.steps.indexOf(s) + 1 : 0;
  if (!s || s.status !== "doing") return;
  if (t && ["queued", "running", "awaiting_approval"].includes(t.status)) return;
  if (t?.status === "done") {
    s.status = "done"; s.note = progressLine(t.result) || undefined; s.at = new Date(now).toISOString();
    log(j, now, `Step ${n} done${s.note ? `: ${s.note}` : ""}`);
    if (j.steps.every((x) => x.status === "done")) { j.status = "done"; log(j, now, "All steps done"); }
    return;
  }
  s.status = "failed"; s.note = (t ? t.error ?? t.status : "its task is gone")?.slice(0, 200); s.at = new Date(now).toISOString();
  log(j, now, `Step ${n} failed: ${s.note}`);
}

/** His Retry on a failed step: back to todo (a new task; the failed one stays as evidence). */
export function retryFailed(j: PlanJob, now: number): boolean {
  const s = j.steps.find((x) => x.status === "failed");
  if (!s) return false;
  Object.assign(s, { status: "todo", task: undefined, note: undefined });
  j.status = "active";
  log(j, now, `Step ${j.steps.indexOf(s) + 1} retried`);
  return true;
}

/** The step's agent request: the startup routine (plan + progress so far), then this ONE step only. The [key] marker is the
 *  step's idempotency key (job-log effect step), so a crash between insert and save finds the same task. */
export function stepRequest(j: PlanJob, s: PJStep, idem: string): string {
  const i = j.steps.indexOf(s) + 1, plan = j.steps.map((x, k) => `${k + 1}. [${x.status === "done" ? "x" : k + 1 === i ? ">" : " "}] ${x.text}${x.note ? ` (${x.note})` : ""}`).join("\n");
  return [`Long job "${j.title}", step ${i} of ${j.steps.length}. Start by reading the plan and progress below; earlier steps are finished, don't redo them.`,
    j.goal && `GOAL: ${j.goal}`, `PLAN:\n${plan}`, j.progress.length ? `PROGRESS SO FAR:\n${j.progress.slice(-10).join("\n")}` : "",
    `DO ONLY STEP ${i}: ${s.text}`,
    "Anything that would send, publish, upload or spend goes through an approval tool and waits for the owner's click. End your answer with one line \"PROGRESS: <what this step produced, short>\".",
    `[${idem}]`].filter(Boolean).join("\n\n").slice(0, 8000);
}
