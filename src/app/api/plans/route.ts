import { requireUser } from "@/lib/supabase/server";
import { currentStudioPlan as currentPlan, resumeStudioPlans, studioPlanAction as planAction } from "@/lib/plan-jobs";
import { progressLine } from "@/lib/plans-pure";

export const dynamic = "force-dynamic";

// CORE plans: GET the latest plan (+ its progress line); POST { id, op: "confirm"|"cancel", step } = the owner's OK / Cancel click.
// Confirming is only possible here (signed-in UI click); CORE's tools can create plans but never confirm a step.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  void resumeStudioPlans(); // owner lane: he has CORE open
  const plan = await currentPlan();
  return Response.json({ plan: plan && { ...plan, line: progressLine(plan) } });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; op?: unknown; step?: unknown } | null;
  if (typeof b?.id !== "string" || (b.op !== "confirm" && b.op !== "cancel") || (b.op === "confirm" && !Number.isInteger(b.step))) return Response.json({ error: "id, op (confirm|cancel) and step required" }, { status: 400 });
  const err = await planAction(b.id, b.op, b.step as number);
  if (err) return Response.json({ error: err }, { status: 409 });
  const plan = await currentPlan();
  return Response.json({ plan: plan && { ...plan, line: progressLine(plan) } });
}
