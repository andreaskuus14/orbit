export type WriteEvidence = { kind: "memory" | "file" | "project" | "task" | "automation"; id: string; path?: string; bytes?: number; rev?: string; check?: string };
export type ActionResult = { status: string; note?: string; evidence?: WriteEvidence[] };
export type Completion = { status: "done" | "failed" | "cancelled" | "awaiting_approval"; error: string | null };

/** Pending work must settle before a parent can finish. A reply is not proof that its actions ran. */
export function completionState(actions: ActionResult[], children: { status: string }[] = []): Completion {
  if (actions.some((a) => a.status === "pending") || children.some((c) => ["queued", "running", "awaiting_approval"].includes(c.status)))
    return { status: "awaiting_approval", error: null };
  if (actions.some((a) => a.status === "attempting" || a.status === "uncertain")) return { status: "failed", error: UNCERTAIN_ERROR };
  const failed = actions.filter((a) => a.status === "failed");
  if (failed.length) return { status: "failed", error: `${failed.length} approved action(s) failed. Review action results before retrying.` };
  if (actions.some((a) => a.status === "rejected")) return { status: "cancelled", error: "You rejected the proposed actions; they were not completed." };
  if (children.some((c) => c.status !== "done")) return { status: "failed", error: "Delegated work did not complete. Review the sub-task results." };
  return { status: "done", error: null };
}

export function matchesStored(expected: Record<string, unknown>, actual: Record<string, unknown> | null): boolean {
  return !!actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

/** Executed ≠ verified: every recorded action (including sub-tasks) needs its own valid read-back receipt.
 * This proves recorded writes were read back, not that the task's broader requirements were met. */
export const taskVerified = (status: string, actions: ActionResult[]) => status === "done" && actions.length > 0 && actions.every((a) =>
  a?.status === "approved" && Array.isArray(a.evidence) && a.evidence.length > 0 && a.evidence.every((e) =>
    e && ["memory", "file", "project", "task", "automation"].includes(e.kind) && typeof e.id === "string" && e.id.trim().length > 0
  )
);
/** D01: name what was checked, not a blanket "Verified". Tasks only prove execution and read-back of approved writes. */
export const doneLabel = (readBack: boolean) => (readBack ? "Done · executed, read back" : "Done · executed, not read back");

/** Resetting resolved actions would discard receipts and may repeat an already-applied write. */
export const canRetryTask = (actions: ActionResult[]) => actions.every((a) => a.status === "pending");

// Approved-action attempts. resolvePending saves status "attempting" + a stable id BEFORE running an action and the receipt after it.
// An attempt found without a receipt (crash between the write and its record) becomes "uncertain": it may or may not have happened,
// so it is never re-run automatically; the owner inspects it (task detail / mission panel show the note).
export const attemptId = (taskId: string, index: number) => `${taskId}:${index}`;
/** The tag an approved save_memory carries, so a rerun of the same attempt finds its memory instead of saving it again. */
export const attemptTag = (attempt: string) => `attempt:${attempt}`;
export const UNCERTAIN_NOTE = "Needs inspection: ORBIT stopped while running this approved action and has no receipt, so it can't tell whether it happened. Check its result before doing it again.";
/** An approved action that started and then threw: it may have written before the error, so its outcome is unknown. */
export const startedThenFailed = (why: string) => `Needs inspection: this approved action started and then failed (${why.slice(0, 300)}), so it may or may not have happened. Check its result before doing it again; Retry this step finds an earlier write by its attempt id instead of repeating it.`;
export const UNCERTAIN_ERROR = "Needs inspection: an approved action may or may not have happened (no receipt). Check its result before doing it again.";
export const unsure = (actions: unknown) => Array.isArray(actions) && actions.some((a) => ["attempting", "uncertain"].includes((a as ActionResult)?.status));

/** The update for a task found "running" with no live runner (restart): failed, and any attempt without a receipt marked uncertain. */
export function interruptedPatch(pending: ActionResult[] | null | undefined, error: string) {
  const marked = (pending ?? []).map((a) => (a.status === "attempting" ? { ...a, status: "uncertain", note: UNCERTAIN_NOTE } : a));
  return { status: "failed", error: unsure(marked) ? UNCERTAIN_ERROR : error, pending: marked, finished_at: new Date().toISOString() };
}

/** A restart kills every in-process runner, so a task still "running" that started before this process booted can never finish. */
export const INTERRUPTED = "Interrupted: ORBIT restarted while this ran. Resumable: press Retry (or Resume on a step); approved actions with receipts are kept, any without one is marked Check manually.";
export const startedBeforeBoot = (startedAt: string | null, bootAt: number) => !startedAt || Date.parse(startedAt) < bootAt;
