export type WriteEvidence = { kind: "memory" | "file" | "project" | "task" | "automation"; id: string; path?: string; bytes?: number };
export type ActionResult = { status: string; note?: string; evidence?: WriteEvidence[] };
export type Completion = { status: "done" | "failed" | "cancelled" | "awaiting_approval"; error: string | null };

/** Pending work must settle before a parent can finish. A reply is not proof that its actions ran. */
export function completionState(actions: ActionResult[], children: { status: string }[] = []): Completion {
  if (actions.some((a) => a.status === "pending") || children.some((c) => ["queued", "running", "awaiting_approval"].includes(c.status)))
    return { status: "awaiting_approval", error: null };
  const failed = actions.filter((a) => a.status === "failed");
  if (failed.length) return { status: "failed", error: `${failed.length} approved action(s) failed. Review action results before retrying.` };
  if (actions.some((a) => a.status === "rejected")) return { status: "cancelled", error: "You rejected the proposed actions; they were not completed." };
  if (children.some((c) => c.status !== "done")) return { status: "failed", error: "Delegated work did not complete. Review the sub-task results." };
  return { status: "done", error: null };
}

export function matchesStored(expected: Record<string, unknown>, actual: Record<string, unknown> | null): boolean {
  return !!actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

/** Resetting resolved actions would discard receipts and may repeat an already-applied write. */
export const canRetryTask = (actions: ActionResult[]) => actions.every((a) => a.status === "pending");
