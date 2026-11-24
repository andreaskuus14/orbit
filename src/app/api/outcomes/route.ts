import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { OUTCOME_TEMPLATES, reviewDeskSummary, type OutcomeTemplateId, type StepStatus } from "@/lib/outcome-cockpit-pure";
import {
  createOutcome,
  decideOutcomeApproval,
  deleteOutcome,
  listOutcomes,
  retryOutcomeStep,
  runParallelOutcomeSteps,
  setOutcomeCheck,
  setOutcomeStep,
  skipPlanReview,
} from "@/lib/outcome-cockpit";
import {
  advanceOutcomesBackground,
  dispatchAutoHeal,
  dispatchReadyRuns,
  dispatchStepRun,
  distillProjectLearnings,
  runLocalCheckVerifier,
  runPlanReview,
  syncProjectRuns,
} from "@/lib/outcome-runner";
import { planReviewPending } from "@/lib/outcome-debate-pure";

export const dynamic = "force-dynamic";

function csrfBlock(req: Request, method: string) {
  const h = req.headers;
  return crossSiteBlocked(method, "/api/outcomes", {
    secFetchSite: h.get("sec-fetch-site"),
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
  });
}

const VALID_TEMPLATES = new Set<OutcomeTemplateId>(["roblox-update", "week-of-shorts", "client-shop", "custom"]);
const VALID_STEP_STATUS = new Set<Exclude<StepStatus, "waiting_approval">>(["queued", "running", "verifying", "needs_fix", "verified", "blocked"]);

async function GET_() {
  const { user, res } = await requireUser();
  if (res) return res;
  const projects = await listOutcomes(user.id);
  return Response.json({
    templates: OUTCOME_TEMPLATES,
    projects: projects.map((p) => ({ ...p, summary: reviewDeskSummary(p) })),
  });
}

async function POST_(req: Request) {
  if (csrfBlock(req, "POST")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });

  const action = typeof b.action === "string" ? b.action : "create";
  if (action === "create") {
    const rawTpl = typeof b.template === "string" ? b.template : "custom";
    const template: OutcomeTemplateId = VALID_TEMPLATES.has(rawTpl as OutcomeTemplateId) ? (rawTpl as OutcomeTemplateId) : "custom";
    const out = await createOutcome(user.id, {
      template,
      title: typeof b.title === "string" ? b.title : undefined,
      brief: typeof b.brief === "string" ? b.brief : undefined,
    });
    if (out.error || !out.project) return Response.json({ error: out.error ?? "Could not create outcome" }, { status: 400 });
    // the critic review takes a minute: start it now and let the cockpit poll, rather than holding this request open
    if (planReviewPending(out.project)) void runPlanReview(sb, user.id, out.project.id).catch((e) => console.error("[orbit] plan review", e));
    return Response.json({ project: { ...out.project, summary: reviewDeskSummary(out.project) } }, { status: 201 });
  }

  if (action === "advance_background") {
    const summary = await advanceOutcomesBackground(sb, user.id, {
      maxActions: typeof b.maxActions === "number" ? b.maxActions : undefined,
    });
    return Response.json({ ok: true, ...summary });
  }

  const id = typeof b.id === "string" ? b.id : "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  let out: { project?: Awaited<ReturnType<typeof listOutcomes>>[number]; error?: string };
  let meta: Record<string, unknown> = {};
  if (action === "plan_review") {
    out = await runPlanReview(sb, user.id, id);
  } else if (action === "skip_review") {
    out = await skipPlanReview(user.id, id);
  } else if (action === "run_parallel") {
    out = await runParallelOutcomeSteps(user.id, id);
  } else if (action === "run_step") {
    const stepId = typeof b.stepId === "string" ? b.stepId : "";
    if (!stepId) return Response.json({ error: "stepId required" }, { status: 400 });
    const resRun = await dispatchStepRun(sb, user.id, id, stepId);
    out = { project: resRun.project, error: resRun.error };
    if (resRun.runId) meta = { runId: resRun.runId, runnerKind: resRun.runnerKind };
  } else if (action === "run_ready") {
    const resReady = await dispatchReadyRuns(sb, user.id, id);
    out = { project: resReady.project, error: resReady.error };
    meta = { dispatched: resReady.dispatched, errors: resReady.errors };
  } else if (action === "sync_runs") {
    const resSync = await syncProjectRuns(sb, user.id, id, { autoHeal: b.autoHeal === true });
    out = { project: resSync.project, error: resSync.error };
    meta = {
      synced: resSync.synced,
      ...(resSync.healed ? { healed: resSync.healed } : {}),
      ...(resSync.distilled ? { distilled: resSync.distilled } : {}),
    };
  } else if (action === "auto_heal") {
    const stepId = typeof b.stepId === "string" ? b.stepId : undefined;
    const resHeal = await dispatchAutoHeal(sb, user.id, id, stepId);
    out = { project: resHeal.project, error: resHeal.error };
    meta = { healed: resHeal.healed, errors: resHeal.errors };
  } else if (action === "distill") {
    const resDistill = await distillProjectLearnings(user.id, id);
    out = { project: resDistill.project, error: resDistill.error };
    meta = { skillName: resDistill.skillName, mistakesSaved: resDistill.mistakesSaved };
  } else if (action === "verify_check") {
    const checkId = typeof b.checkId === "string" ? b.checkId : "";
    if (!checkId) return Response.json({ error: "checkId required" }, { status: 400 });
    const luauFiles = Array.isArray(b.luauFiles) ? (b.luauFiles as { path: string; code: string }[]) : undefined;
    const resVerify = await runLocalCheckVerifier(user.id, id, checkId, { luauFiles });
    out = { project: resVerify.project, error: resVerify.error };
    meta = { verifier: resVerify.verifier, pass: resVerify.pass, proof: resVerify.proof };
  } else if (action === "step") {
    const stepId = typeof b.stepId === "string" ? b.stepId : "";
    const status = typeof b.status === "string" && VALID_STEP_STATUS.has(b.status as Exclude<StepStatus, "waiting_approval">)
      ? (b.status as Exclude<StepStatus, "waiting_approval">)
      : null;
    if (!stepId || !status) return Response.json({ error: "stepId and valid status required" }, { status: 400 });
    out = await setOutcomeStep(user.id, id, stepId, status, {
      reused: b.reused === true ? true : undefined,
      note: typeof b.note === "string" ? b.note : undefined,
    });
  } else if (action === "check") {
    const checkId = typeof b.checkId === "string" ? b.checkId : "";
    if (!checkId || typeof b.pass !== "boolean") return Response.json({ error: "checkId and boolean pass required" }, { status: 400 });
    out = await setOutcomeCheck(user.id, id, checkId, b.pass, typeof b.proof === "string" ? b.proof : "");
  } else if (action === "retry_fix") {
    const stepId = typeof b.stepId === "string" ? b.stepId : "";
    if (!stepId) return Response.json({ error: "stepId required" }, { status: 400 });
    out = await retryOutcomeStep(user.id, id, stepId);
  } else if (action === "approve" || action === "reject") {
    const approvalId = typeof b.approvalId === "string" ? b.approvalId : "";
    if (!approvalId) return Response.json({ error: "approvalId required" }, { status: 400 });
    out = await decideOutcomeApproval(user.id, id, approvalId, action === "approve" ? "approved" : "rejected");
  } else {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  if (out.error || !out.project) return Response.json({ error: out.error ?? "Update failed" }, { status: 400 });
  return Response.json({ project: { ...out.project, summary: reviewDeskSummary(out.project) }, ...meta });
}

async function DELETE_(req: Request) {
  if (csrfBlock(req, "DELETE")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await deleteOutcome(user.id, id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
export const GET = guard("outcomes", GET_);
export const POST = guard("outcomes", POST_);
export const DELETE = guard("outcomes", DELETE_);
