// Pinned-skill run status (Mission Control). The label comes from evidence, never from "the stream ended":
// a background run's task row first, then main's verified turn receipt (receipt-pure.ts) from the `done` trace. Tests: tests/skill-run.test.ts.
export type SkillRunState = "queued" | "handled" | "started" | "finished" | "completed" | "partial" | "reply" | "waiting" | "failed" | "cancelled";
type TraceStep = { policy?: unknown; receipt?: unknown };

const RECEIPT: Record<string, SkillRunState> = { verified: "completed", partly: "partial", unverified: "reply", failed: "failed" };

/** An inline turn's end state from its `done` trace: a policy stop is "waiting" (it needs the owner's go-ahead), else the receipt's status; no receipt (nothing changed) = a reply, not a verified completion. */
export function turnRunState(trace: readonly TraceStep[] | undefined | null): SkillRunState {
  const steps = Array.isArray(trace) ? trace.filter((s) => s && typeof s === "object") : [];
  if (steps.some((s) => s.policy)) return "waiting";
  const status = (steps.findLast((s) => s.receipt)?.receipt as { status?: unknown } | undefined)?.status;
  return typeof status === "string" && RECEIPT[status] || "reply";
}

const LABEL: Record<SkillRunState, string> = {
  queued: "Queued", handled: "Handled by a command", started: "Started", finished: "Finished", completed: "Completed", partial: "Partly done",
  reply: "Reply ready", waiting: "Waiting for you", failed: "Failed", cancelled: "Cancelled",
};
const TASK: Record<string, string> = { awaiting_approval: "Needs approval", done: "Completed", failed: "Failed", cancelled: "Cancelled" };

/** The row's label: the background task row decides when it is known (it is the record of how the run ended), else the receipt state. */
export function skillRunLabel(receipt: { state: SkillRunState } | undefined, taskStatus?: string): string {
  return (taskStatus && TASK[taskStatus]) || (receipt ? LABEL[receipt.state] : "");
}
