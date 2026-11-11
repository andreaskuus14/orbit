import { rowReceipt } from "./receipt-pure.ts";
import { unsure } from "./completion-pure.ts";

// "Continue my work": a small inbox built from existing task and goal records (IO: work-continuation.ts, UI: ContinueWork.tsx).
// at: when this attempt started (shown so an old failure never reads as today's); state: one of the task/goal statuses, or
// "uncertain" for a task marked running with no live worker in this ORBIT process.
export type WorkItem = { kind: "task" | "goal"; id: string; title: string; status: string; detail: string; action: string; at?: string; next?: string };
export type WorkSummary = { items: WorkItem[]; more: number; problems: string[] };
// exec: execution evidence from this process (agents.ts taskExecution): active = a worker here runs it now; restart = it started
// before this ORBIT process booted (the scheduler marks it interrupted); unknown = marked running but no worker found here.
export type Exec = "active" | "restart" | "unknown" | "unchecked"; // unchecked: the evidence couldn't be read
export type WorkTask = {
  id: string; title: string; status: string; created_at: string; started_at?: string | null; error?: string | null; agent?: string | null;
  request?: string | null; pending?: unknown; trace?: { step: string; receipt?: unknown }[] | null; automation_id?: string | null; origin?: string | null; exec?: Exec;
};
export type WorkGoal = { id: string; updated_at: string; doc: { title: string; status: string; waitingFor?: string; blocker?: string; steps: { status: string; taskId?: string }[] } };
export type EvalCase = { title: string; request: string; agent: string };
export type NewerRun = { at: string; verified: boolean };
const text = (x: unknown, fallback: string) => typeof x === "string" && x.trim() ? x.trim().slice(0, 200) : fallback;

/** An ANALYTICS scorecard replay, not his own work. Explicit origin when recorded (migration 0025); older rows only when agent,
 *  title AND request all match a known case exactly (never the title alone). */
export function isEvaluation(t: WorkTask, cases: readonly EvalCase[]): boolean {
  if (t.origin) return t.origin === "scorecard";
  return cases.some((c) => t.title === `Scorecard: ${c.title}` && t.request === c.request && t.agent === c.agent);
}

/** A failed task's reason in one short, safe line (its stored error, else what its receipt says failed) and the next step. */
const UNRECORDED = "An approved action started, but its outcome wasn't recorded; it may already have happened";
const CHECK_FIRST = "Check whether the action happened before retrying: a retry could do it twice";
export function failureReason(t: WorkTask): { reason: string; next: string } {
  const err = (t.error ?? "").split("\n")[0].replace(/^Error:\s*/i, "").trim();
  const rc = rowReceipt({ title: t.title, status: t.status, error: t.error, request: t.request, pending: Array.isArray(t.pending) ? t.pending : null, trace: t.trace ?? null });
  const failedStep = rc?.failed.find((f) => !/^failed\.?$/i.test(f.trim())) ?? ""; // the bare placeholder isn't a reason
  const reason = (err || failedStep || "No reason was recorded").replace(/\s+/g, " ").slice(0, 140);
  if (unsure(t.pending)) return { reason: `${UNRECORDED}. ${reason}`.slice(0, 200), next: CHECK_FIRST }; // never "safe to retry"
  const r = `${err} ${failedStep}`;
  const next = /interrupted|restarted/i.test(r) ? "ORBIT restarted during it: Retry"
    : /usage limit|rate limit|quota|limit reached/i.test(r) ? "Wait until Claude's limit resets, then Retry"
    : /stop-?all|stopped by you/i.test(r) ? "Stopped by Stop-all: Retry when you're ready"
    : /timed? ?out|timeout|ran out of time/i.test(r) ? "It ran out of time: Retry, or split the request"
    : failedStep ? "Some of its steps didn't check out: open it to see which"
    : "Open it to see what failed, then Retry";
  return { reason, next };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Build a small inbox from existing records. Linked goal tasks appear once, as the goal's next step. Evaluation tasks are left
 *  out (ANALYTICS shows them). newerOk: per automation id, its latest later run that finished without a failed or partly
 *  failed receipt (verified: its receipt proves the result), so an older failed attempt
 *  of the same automation reads as history, not as today's state; it stays listed for inspection. */
export function continueWork(tasks: WorkTask[], goals: WorkGoal[], problems: string[] = [], cases: readonly EvalCase[] = [], newerOk: Record<string, NewerRun> = {}): WorkSummary {
  const rows: { item: WorkItem; rank: number; at: number }[] = [];
  const linked = new Set<string>();
  for (const g of goals) {
    const d = g.doc;
    if (!d || ["done", "stopped"].includes(d.status)) continue;
    if (!["draft", "approved", "running", "waiting", "paused", "blocked"].includes(d.status)) continue;
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const step = steps.find((s) => s && s.status !== "done");
    // A task awaiting approval must open the actual approval screen.
    const task = tasks.find((t) => t.id === step?.taskId);
    for (const s of steps) if (s?.taskId) linked.add(s.taskId);
    const needsTask = task?.status === "awaiting_approval";
    const detail = needsTask ? "This goal's task needs your approval"
      : d.status === "draft" ? "Review the proposed plan"
      : d.status === "blocked" ? text(d.blocker, "Review the blocker")
      : d.status === "waiting" ? text(d.waitingFor, "Review what this goal is waiting for")
      : d.status === "paused" ? "Paused by you"
      : `${steps.filter((s) => s?.status === "done").length}/${steps.length} steps finished`;
    rows.push({ item: { kind: needsTask ? "task" : "goal", id: needsTask ? task.id : g.id, title: text(d.title, "Untitled goal"), status: needsTask ? task.status : d.status, detail,
      action: needsTask ? "Review approval" : d.status === "draft" ? "Review plan" : d.status === "running" ? "View progress" : "Open goal" },
      rank: needsTask ? 0 : d.status === "waiting" || d.status === "draft" ? 1 : d.status === "blocked" ? 2 : d.status === "running" ? 4 : 3,
      at: Date.parse(g.updated_at) || 0 });
  }
  for (const t of tasks) {
    if (linked.has(t.id) || !["queued", "running", "awaiting_approval", "failed"].includes(t.status) || isEvaluation(t, cases)) continue;
    const at = t.started_at ?? t.created_at;
    const base = { kind: "task" as const, id: t.id, title: text(t.title, "Untitled task"), at };
    if (t.status === "failed") {
      const { reason, next } = failureReason(t);
      const later = t.automation_id ? newerOk[t.automation_id] : undefined;
      const newer = later && Date.parse(later.at) > Date.parse(at) ? later : null;
      // only a verified newer run is called a success; a finished-but-unverified one is named as such and still asks for a check
      rows.push({ item: { ...base, status: "failed",
        detail: !newer ? `Failed ${day(at)}: ${reason}` : newer.verified ? `Earlier attempt (${day(at)}): ${reason}. A newer run succeeded ${day(newer.at)} (verified).`
          : `Earlier attempt (${day(at)}): ${reason}. A newer run finished ${day(newer.at)}, but its result isn't verified.`,
        next: !newer ? next : newer.verified ? "Nothing to redo: open it only to see what went wrong" : "Check the newer run's result before relying on it", action: "Review issue" },
        rank: newer?.verified ? 5 : newer ? 3 : 2, at: Date.parse(at) || 0 });
      continue;
    }
    if (t.status === "running" && t.exec !== "active") { // marked running, but nothing here is running it: never shown as working
      rows.push({ item: { ...base, status: "uncertain", action: "View progress",
        detail: unsure(t.pending) ? `${UNRECORDED} (started ${day(at)}, no worker is running it now)`
          : t.exec === "restart" ? `Started ${day(at)} before ORBIT restarted; it is being marked interrupted`
          : t.exec === "unknown" ? `Marked running since ${day(at)}; ORBIT found no worker running it, so it may have stopped`
          : `Marked running since ${day(at)}; couldn't confirm whether it is still running`,
        next: unsure(t.pending) ? CHECK_FIRST : t.exec === "restart" ? "Open it to check what finished, then Retry if needed" : "Open it to see its progress before retrying anything" }, rank: 2, at: Date.parse(at) || 0 });
      continue;
    }
    rows.push({ item: { ...base, status: t.status,
      detail: t.status === "awaiting_approval" ? "Actions are waiting for your decision" : t.status === "queued" ? "Waiting for an agent slot" : "Agent is working on it now",
      action: t.status === "awaiting_approval" ? "Review approval" : "View progress" },
      rank: t.status === "awaiting_approval" ? 0 : 4, at: Date.parse(at) || 0 });
  }
  rows.sort((a, b) => a.rank - b.rank || b.at - a.at || a.item.id.localeCompare(b.item.id));
  return { items: rows.slice(0, 6).map((r) => r.item), more: Math.max(0, rows.length - 6), problems };
}
