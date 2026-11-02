import { requireUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/agents";
import { createPlanJob, listPlanJobs, patchPlanJob } from "@/lib/plan-jobs";

export const dynamic = "force-dynamic";

/** OPERATIONS → Plans: long jobs with their plan file (steps, progress). Files on this PC (plan-jobs.ts). */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ jobs: await listPlanJobs() }, { headers: { "Cache-Control": "private, no-store" } });
}

/** {title, agent, goal?, night?, steps: "one per line"} → a new job; the scheduler starts its first step. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON object required" }, { status: 400 });
  if (!(await getAgent(sb, String(b.agent ?? ""), user.id))) return Response.json({ error: `Unknown agent "${String(b.agent ?? "")}"` }, { status: 400 });
  const j = await createPlanJob(b);
  return typeof j === "string" ? Response.json({ error: j }, { status: 400 }) : Response.json({ job: j }, { status: 201 });
}

/** {id, action: pause | resume | retry | delete} */
export async function PATCH(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  if (typeof b?.id !== "string" || !/^[\w-]{1,64}$/.test(b.id)) return Response.json({ error: "id required" }, { status: 400 });
  const err = await patchPlanJob(b.id, b.action);
  return err ? Response.json({ error: err }, { status: err === "Not found" ? 404 : 400 }) : Response.json({ ok: true });
}
