import { requireUser } from "@/lib/supabase/server";
import { BusyError } from "@/lib/claude";
import { addTarget, checkTarget, listTargets, removeTarget } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AI VISIBILITY (BUSINESS). GET: tracked names with their checks. POST {action:"add"|"remove"|"check", name}.
// Cross-site POSTs are refused by the middleware for every /api route.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await listTargets());
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.name !== "string") return fail("name required");
  if (b.action === "add") { const r = await addTarget(b.name); return "error" in r ? fail(r.error) : Response.json(await listTargets()); }
  if (b.action === "remove") { await removeTarget(b.name); return Response.json(await listTargets()); }
  if (b.action !== "check") return fail("action must be add, remove or check");
  try { await checkTarget(b.name, req.signal); return Response.json(await listTargets()); }
  catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(e instanceof Error ? e.message : "Check failed", 502);
  }
}
