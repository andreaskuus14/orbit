// CORE multi-step plans (pure, tested in tests/plans.test.ts): "make 5 shorts from today's stream and schedule the best 3" becomes a
// short list of steps mapped to existing STUDIO actions only. Runner: src/lib/plan-jobs.ts (STUDIO plans section). Any step that publishes or schedules
// pauses the plan until the owner clicks OK in CorePanel (confirmStep, from POST /api/plans only — CORE has no way to confirm).

export const STEP_ORDER = ["clip", "wait", "pick_best", "approve", "schedule"] as const;
export type StepType = (typeof STEP_ORDER)[number];
export type StepArgs = { source?: string; count?: number; maxSec?: number; layout?: "fit" | "fill" | "split" | "follow"; n?: number };
export type PlanStep = { type: StepType; args: StepArgs; status: "pending" | "running" | "done" | "failed"; confirmed?: boolean; note?: string };
export type PlanStatus = "running" | "waiting" | "done" | "failed" | "cancelled";
export type Plan = { id: string; goal: string; createdAt: string; updatedAt: string; status: PlanStatus; current: number; steps: PlanStep[];
  jobId?: string; picked?: string[]; progress?: number; error?: string };
export type PlansState = { v: 1; plans: Plan[] };
export const emptyPlans = (): PlansState => ({ v: 1, plans: [] });

/** Steps that publish or schedule: they never run without the owner's click. */
export const needsConfirm = (t: StepType) => t === "schedule";
export const isActive = (p: Plan) => p.status === "running" || p.status === "waiting";

const VIDEO = /^[^\\/:*?"<>|\0]{1,200}\.(mp4|mkv|mov|webm|m4v|avi|flv|ts)$/i;
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** CORE's plan_task input → a checked plan draft, or why not. Steps must follow clip → wait → pick_best → approve → schedule (each at most
 *  once, gaps allowed but every step needs the ones it depends on); a missing wait is added before picking. */
export function validatePlan(x: unknown): { goal: string; steps: PlanStep[] } | string {
  const o = x as { goal?: unknown; steps?: unknown };
  if (!o || typeof o !== "object" || !Array.isArray(o.steps) || !o.steps.length || o.steps.length > STEP_ORDER.length) return `steps must be a list of 1-${STEP_ORDER.length} steps`;
  const steps: PlanStep[] = [];
  let last = -1;
  for (const raw of o.steps as Record<string, unknown>[]) {
    const type = raw?.type as StepType, at = STEP_ORDER.indexOf(type);
    if (at < 0) return `unknown step "${String(raw?.type).slice(0, 30)}"; use ${STEP_ORDER.join(", ")}`;
    if (at <= last) return `steps must go in this order, each once: ${STEP_ORDER.join(" → ")}`;
    last = at;
    const args: StepArgs = {};
    if (type === "clip") {
      const { source = "latest", count = 5, maxSec, layout } = raw;
      if (source !== "latest" && !(typeof source === "string" && VIDEO.test(source))) return 'clip.source must be "latest" (newest unclipped inbox video) or an inbox video file name';
      if (!int(count, 1, 10)) return "clip.count must be 1-10";
      if (maxSec !== undefined && !int(maxSec, 15, 120)) return "clip.maxSec must be 15-120";
      if (layout !== undefined && !["fit", "fill", "split", "follow"].includes(layout as string)) return "clip.layout must be fit, fill, split or follow";
      Object.assign(args, { source, count }, maxSec === undefined ? {} : { maxSec }, layout === undefined ? {} : { layout });
    }
    if (type === "pick_best") {
      if (!int(raw.n, 1, 10)) return "pick_best.n must be 1-10";
      args.n = raw.n as number;
    }
    steps.push({ type, args, status: "pending" });
  }
  const has = (t: StepType) => steps.some((s) => s.type === t);
  if (steps[0].type !== "clip") return "a plan starts with a clip step";
  if (has("approve") && !has("pick_best")) return "approve needs a pick_best step first";
  if (has("schedule") && !has("approve")) return "schedule needs approve first (only approved clips are scheduled)";
  const count = steps[0].args.count ?? 5, pick = steps.find((s) => s.type === "pick_best");
  if (pick && pick.args.n! > count) return `pick_best.n can't be more than the ${count} clips made`;
  if (!has("wait") && steps.length > 1) steps.splice(1, 0, { type: "wait", args: {}, status: "pending" });
  const goal = typeof o.goal === "string" && o.goal.trim() ? o.goal.replace(/[<>\r\n]/g, " ").trim().slice(0, 120) : "Clip plan";
  return { goal, steps };
}

/** What the runner may do next: run the current step, pause for the owner's OK, finish, or stop (cancelled/failed/done). */
export function nextMove(p: Plan): "run" | "wait_ok" | "finish" | "stop" {
  if (!isActive(p)) return "stop";
  const s = p.steps[p.current];
  if (!s) return "finish";
  return needsConfirm(s.type) && !s.confirmed ? "wait_ok" : "run";
}

/** The owner's OK click for step `index`: only for the step the plan is waiting on. Returns "" or why not. */
export function confirmStep(p: Plan, index: number): string {
  if (p.status !== "waiting") return "This plan isn't waiting for an OK";
  if (index !== p.current || !p.steps[index] || !needsConfirm(p.steps[index].type)) return "That step doesn't need an OK right now";
  p.steps[index].confirmed = true;
  p.status = "running";
  return "";
}

export function cancelPlan(p: Plan): string {
  if (!isActive(p)) return "This plan already ended";
  p.status = "cancelled";
  const s = p.steps[p.current];
  if (s?.status === "running") s.note = "Cancelled (a clip job already started keeps running in STUDIO)";
  return "";
}

/** The n best original (non-version) ready clips by score. */
export const pickBest = (clips: { id: string; status: string; score: number; variantOf?: string }[], n: number) =>
  clips.filter((c) => c.status === "ready" && !c.variantOf).sort((a, b) => b.score - a.score).slice(0, n).map((c) => c.id);

export function stepText(s: PlanStep, p?: Pick<Plan, "picked">): string {
  const k = p?.picked?.length;
  switch (s.type) {
    case "clip": return `make ${s.args.count} clips from ${s.args.source === "latest" ? "the newest inbox video" : s.args.source}`;
    case "wait": return "rendering";
    case "pick_best": return `pick the best ${s.args.n}`;
    case "approve": return `approve ${k ?? "the picked"} clip${k === 1 ? "" : "s"}`;
    case "schedule": return `schedule ${k ?? "the approved"} clip${k === 1 ? "" : "s"} into the next free slots`;
  }
}

/** "Step 2/4: rendering… 62%" for the CorePanel card. */
export function progressLine(p: Plan): string {
  const total = p.steps.length, i = Math.min(p.current, total - 1), s = p.steps[i];
  if (p.status === "done") return `Done: all ${total} steps finished.`;
  if (p.status === "cancelled") return `Cancelled at step ${i + 1}/${total}.`;
  if (p.status === "failed") return `Stopped at step ${i + 1}/${total}: ${p.error ?? "failed"}`;
  const head = `Step ${i + 1}/${total}: ${stepText(s, p)}`;
  if (p.status === "waiting") return `${head} — Waiting for your OK`;
  return s.type === "wait" ? `${head}… ${Math.round(p.progress ?? 0)}%` : `${head}…`;
}

/** "" when a plans state is usable (also the old <studio>/plans.json, migrated by plan-jobs.ts). */
export function plansProblem(x: unknown): string {
  const s = x as PlansState;
  if (!s || s.v !== 1 || !Array.isArray(s.plans)) return "not a plans state";
  return s.plans.every((p) => p && typeof p.id === "string" && Array.isArray(p.steps) && typeof p.current === "number" && typeof p.status === "string") ? "" : "bad plan";
}
