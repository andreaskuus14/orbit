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
} from "@/lib/outcome-cockpit";

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

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  const projects = await listOutcomes(user.id);
  return Response.json({
    templates: OUTCOME_TEMPLATES,
    projects: projects.map((p) => ({ ...p, summary: reviewDeskSummary(p) })),
  });
}

export async function POST(req: Request) {
  if (csrfBlock(req, "POST")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
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
    return Response.json({ project: { ...out.project, summary: reviewDeskSummary(out.project) } }, { status: 201 });
  }

  const id = typeof b.id === "string" ? b.id : "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  let out: { project?: Awaited<ReturnType<typeof listOutcomes>>[number]; error?: string };
  if (action === "run_parallel") {
    out = await runParallelOutcomeSteps(user.id, id);
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
  return Response.json({ project: { ...out.project, summary: reviewDeskSummary(out.project) } });
}

export async function DELETE(req: Request) {
  if (csrfBlock(req, "DELETE")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await deleteOutcome(user.id, id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
