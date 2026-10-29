// MISSIONS (pure, tested in tests/missions.test.ts). Runner: src/lib/missions.ts. API: /api/missions. UI: src/components/MissionsPanel.tsx.
// A mission is one authoritative record (public.missions, `doc` below) around an agent-team chain (chains-pure.ts): the chain's step tasks
// are the checkpoints (a done step is never rerun), the doc holds what the chain can't: constraints, receipts, decisions, blockers, retries.
// Receipts are only things ORBIT itself checked (a task row, an action's read-back evidence, a file on disk) — never the model's word.
import type { ChainView, Limits } from "./chains-pure.ts";
import { DISPROVED_RULE, inferAcceptance, type Check, type Evidence } from "./mission-checks-pure.ts";
import type { Contract } from "./recipes-pure.ts";
import type { RunMetrics } from "./research-pilot-pure.ts";

export type MissionStatus = "queued" | "running" | "waiting-input" | "waiting-approval" | "paused" | "failed" | "completed" | "cancelled";
export type FailureClass = "temporary" | "permission" | "invalid" | "unavailable" | "faulty";
export type Receipt = { kind: "task" | "memory" | "file" | "project" | "automation"; ref: string; step: number; check: string; at: string; path?: string };
export type MissionDoc = {
  v: 1; objective: string; constraints: string[]; status: MissionStatus;
  receipts: Receipt[]; decisions: { at: string; text: string }[]; blocker?: string; failure?: FailureClass;
  retries: Record<string, number>; log: { at: string; text: string }[];
  // success definition + evidence (older docs lack these): acceptance at creation, deterministic checks, reviewed steps, estimate.
  acceptance?: string; assumptions?: string[]; checks?: Check[]; reviewed?: number[]; verified?: boolean; evidence?: Evidence; effort?: { minutes: number; stops: string[] };
  // saved-workflow runs (A02/G01): which workflow, its contract, the artifact it wrote, the next action it recorded, run metrics.
  workflow?: string; contract?: Contract; artifact?: { slug: string; path: string }; next?: string; metrics?: RunMetrics;
  hold?: { check: string; options: string[] }; // Exception hold: a finished workflow whose acceptance check failed waits for the owner
};

export const TERMINAL: MissionStatus[] = ["completed", "cancelled"];
export const MAX_RETRIES = 2; // per step, temporary failures only
export const LABEL: Record<MissionStatus, string> = {
  queued: "Queued", running: "Running", "waiting-input": "Needs you", "waiting-approval": "Waiting for approval",
  paused: "Paused", failed: "Failed", completed: "Completed", cancelled: "Cancelled",
};

/** Which owner actions are allowed from each state. Everything else is driven by the chain's own progress. */
const MOVES: Record<"pause" | "resume" | "cancel" | "retry" | "accept", MissionStatus[]> = {
  pause: ["queued", "running", "waiting-approval"],
  resume: ["paused"],
  cancel: ["queued", "running", "waiting-input", "waiting-approval", "paused", "failed"],
  retry: ["failed", "waiting-input"],
  accept: ["waiting-input"], // only with a hold (actMission checks): close as completed, not verified
};
export type OwnerAction = keyof typeof MOVES;
export const canDo = (a: OwnerAction, s: MissionStatus) => MOVES[a].includes(s);

/** Error text → failure class. Order matters: the most specific signals first; anything unrecognised is faulty output. */
export function classifyFailure(error: string | null | undefined): FailureClass {
  const e = (error ?? "").toLowerCase();
  if (/interrupted|restart|timed? ?out|timeout|econnreset|etimedout|socket hang up|rate.?limit|\b429\b|overloaded|\b50[234]\b|try again|usage limit|temporarily/.test(e)) return "temporary";
  if (/\b40[13]\b|permission|forbidden|unauthori[sz]ed|not allowed|rejected|denied|stop-all|autonomy/.test(e)) return "permission";
  if (/\b400\b|invalid|must be|required|unknown agent|too long|malformed/.test(e)) return "invalid";
  if (/\b404\b|not configured|missing .*key|enotfound|econnrefused|unavailable|offline|not found|no such/.test(e)) return "unavailable";
  return "faulty";
}

export const FAILURE_TEXT: Record<FailureClass, string> = {
  temporary: "a temporary problem (network, limit or restart)",
  permission: "missing permission or a declined approval",
  invalid: "invalid input",
  unavailable: "a service or tool that isn't available",
  faulty: "faulty output",
};

/** Mission state from the stored doc + the chain's live view. The chain is the truth for progress; the doc for owner choices. */
export function deriveStatus(doc: Pick<MissionDoc, "status" | "hold">, chain: Pick<ChainView, "status" | "steps"> | null): MissionStatus {
  if (doc.status === "cancelled" || doc.status === "completed") return doc.status;
  if (!chain) return "failed";
  if (chain.status === "cancelled") return "cancelled";
  if (chain.status === "done") return doc.hold ? "waiting-input" : "completed";
  if (chain.status === "failed") return doc.status === "waiting-input" ? "waiting-input" : "failed";
  if (doc.status === "paused") return "paused";
  if (chain.status === "waiting") return "waiting-approval";
  return chain.steps.every((s) => s.status === "queued") ? "queued" : "running";
}

/** Plain-language line for a state change. */
export function explain(from: MissionStatus, to: MissionStatus, why = ""): string {
  const tail = why ? ` ${why}` : "";
  switch (to) {
    case "running": return from === "paused" ? `Resumed: picking up from the last finished step.${tail}` : from === "failed" || from === "waiting-input" ? `Retrying the failed step; finished steps are kept.${tail}` : `Started working.${tail}`;
    case "waiting-approval": return `Waiting for your approval before an action can run.${tail}`;
    case "waiting-input": return `Stopped: it needs something from you.${tail}`;
    case "paused": return `Paused. A step already running finishes; nothing new starts until you resume.${tail}`;
    case "failed": return `Failed.${tail}`;
    case "completed": return `Completed.${tail}`;
    case "cancelled": return `Cancelled. Finished steps and their receipts are kept; nothing else will run.${tail}`;
    default: return `Queued.${tail}`;
  }
}

type FailedStep = { index: number; error?: string };
/** What to do with a failed chain: retry a temporary failure (bounded), else stop as failed or waiting for the owner. */
/** acted: the failed step already ran an approved action — a blind retry could do it twice, so the owner checks first. */
export function onFailure(step: FailedStep, retries: Record<string, number>, acted = false): { do: "retry"; cls: FailureClass } | { do: "stop"; cls: FailureClass; status: "failed" | "waiting-input"; why: string } {
  const cls = classifyFailure(step.error);
  const n = retries[step.index] ?? 0;
  if (acted) return { do: "stop", cls, status: "waiting-input", why: `Step ${step.index + 1} failed after an approved action ran (or may have run); check its result before retrying so nothing happens twice.` };
  if (cls === "temporary" && n < MAX_RETRIES) return { do: "retry", cls };
  const why = `Step ${step.index + 1} hit ${FAILURE_TEXT[cls]}${cls === "temporary" ? ` and still failed after ${n} retries` : ""}: ${(step.error ?? "unknown error").slice(0, 200)}`;
  return { do: "stop", cls, status: cls === "permission" || cls === "invalid" ? "waiting-input" : "failed", why };
}

/** The one next thing, in plain words. */
export function nextAction(status: MissionStatus, chain: Pick<ChainView, "steps"> | null, blocker?: string): string {
  const k = chain?.steps.findIndex((s) => s.status !== "done") ?? -1;
  const step = k >= 0 && chain ? `step ${k + 1} (${chain.steps[k].agent})` : "";
  switch (status) {
    case "queued": case "running": return step ? `ORBIT runs ${step}.` : "ORBIT is finishing up.";
    case "waiting-approval": return `Approve or reject the action in ${step || "the waiting step"}.`;
    case "waiting-input": return `${blocker ?? "Fix the problem"} — then press Retry.`;
    case "paused": return "Press Resume to continue.";
    case "failed": return "Press Retry to try the failed step again, or Cancel.";
    default: return "Nothing — this mission is closed.";
  }
}

type StepEvidence = { index: number; taskId: string | null; status: string; pending?: unknown };
/** Receipts from what ORBIT verified: each approved action's read-back evidence (also from a failed step: partial results are kept).
 *  A step task merely finishing is not evidence (executed ≠ verified). Deduped by kind+ref. */
export function collectReceipts(steps: StepEvidence[], have: Receipt[], at: string): Receipt[] {
  const seen = new Set(have.map((r) => `${r.kind}:${r.ref}`)), out: Receipt[] = [];
  const add = (r: Receipt) => { const k = `${r.kind}:${r.ref}`; if (!seen.has(k)) { seen.add(k); out.push(r); } };
  for (const s of steps) {
    if (!s.taskId) continue;
    for (const p of Array.isArray(s.pending) ? s.pending : []) {
      const a = p as { status?: unknown; tool?: unknown; evidence?: unknown };
      if (a?.status !== "approved" || !Array.isArray(a.evidence)) continue;
      for (const ev of a.evidence as { kind?: unknown; id?: unknown; path?: unknown }[]) {
        if (typeof ev?.id !== "string" || !["memory", "file", "project", "task", "automation"].includes(ev.kind as string)) continue;
        add({ kind: ev.kind as Receipt["kind"], ref: ev.id, step: s.index, check: `${String(a.tool)} read back after your approval`, at, ...(typeof ev.path === "string" ? { path: ev.path } : {}) });
      }
    }
  }
  return out;
}

/** Read-back receipts only: older docs also hold "step task finished" receipts from before executed/verified were split. */
const checked = (rs: Receipt[]) => rs.filter((r) => r.check.includes("read back"));
/** A step is verified only when ORBIT read back something it produced. */
export const stepVerified = (receipts: Receipt[], step: number) => checked(receipts).some((r) => r.step === step);
/** Status label: a completed mission is "Verified" only when every step has a read-back receipt; otherwise it says so. */
export function missionLabel(status: MissionStatus, receipts: Receipt[], steps: number): string {
  if (status !== "completed") return LABEL[status];
  return steps > 0 && Array.from({ length: steps }, (_, k) => k).every((k) => stepVerified(receipts, k)) ? "Completed · verified" : "Completed · not verified";
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
/** POST/tool input → a new mission's objective + constraints + chain draft (steps checked again by validateChain), or why not. */
export function validateMission(x: unknown): { objective: string; constraints: string[]; acceptance: string; assumptions: string[]; steps: ({ agent: string; request: string } & Limits)[] } | string {
  const o = (x && typeof x === "object" ? x : {}) as { objective?: unknown; constraints?: unknown; acceptance?: unknown; assumptions?: unknown; steps?: unknown };
  const objective = str(o.objective, 300);
  if (!objective) return "objective is required (1-300 characters)";
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map((c) => str(c, 200)).filter(Boolean).slice(0, 8);
  const constraints = list(o.constraints), assumptions = list(o.assumptions);
  // Ask only when the objective doesn't say what "done" looks like.
  const acceptance = str(o.acceptance, 300) || inferAcceptance(objective);
  if (!acceptance) return "acceptance is required here: ask the user in one short question what result counts as done, then pass it as acceptance";
  if (!Array.isArray(o.steps)) return "steps must be a list of 2-5 steps";
  // Constraints, the success condition and assumptions travel with every step's request, so an agent can't miss them.
  const rule = `${constraints.length ? `\n\nMission constraints (must hold): ${constraints.join("; ")}` : ""}\n\nMission is done when: ${acceptance}${assumptions.length ? `\nAssumptions: ${assumptions.join("; ")}${DISPROVED_RULE}` : ""}`;
  // Step limits (calls/minutes/tools/priv) pass through untouched; validateChain checks them and they can only narrow a step.
  const steps = (o.steps as ({ agent?: unknown; request?: unknown } & Limits)[]).map(({ agent, request, ...lim }) => { const r = str(request, 2000 - rule.length); return { ...lim, agent: str(agent, 40).toLowerCase(), request: r && r + rule }; });
  return { objective, constraints, acceptance, assumptions, steps };
}

export function newDoc(objective: string, constraints: string[], at: string, extra: Partial<Pick<MissionDoc, "acceptance" | "assumptions" | "effort" | "workflow" | "contract" | "metrics">> = {}): MissionDoc {
  return { v: 1, objective, constraints, ...extra, status: "queued", receipts: [], decisions: [], retries: {}, log: [{ at, text: explain("queued", "queued", "Mission created.") }] };
}

/** Append a log line, keep the last 60. */
export const logged = (doc: MissionDoc, at: string, text: string): MissionDoc => ({ ...doc, log: [...doc.log, { at, text }].slice(-60) });

/** True when any approved action in a step's pending list ran, or may have run (an attempt without a receipt: "attempting"/"uncertain"). */
export const acted = (pending: unknown) => Array.isArray(pending) && pending.some((p) => ["approved", "attempting", "uncertain"].includes((p as { status?: string })?.status ?? ""));

/** CORE's start_mission only for the owner's own instruction in his latest message, never from page/tool/file content. */
export function missionBlocked(question: string, tainted: boolean): string {
  if (tainted) return "only call start_mission as your first tool, for the user's own request";
  if (/\?\s*$|^\s*(how|what|why|when|did|does|is|are|can you tell)\b/i.test(question)) return "only when the user tells you to do multi-step work in their latest message";
  return "";
}
