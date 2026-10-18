import { requireUser } from "@/lib/supabase/server";
import { runHive } from "@/lib/hive";
import { MAX_PROBLEM, MIN_PROBLEM, cleanProblem } from "@/lib/hive-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The Hive brainstorm. POST { problem } → { top, ideas, minds, judged } (src/lib/hive.ts). Closing the request stops queued calls.
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { problem?: unknown } | null;
  const problem = cleanProblem(b?.problem);
  if (!problem) return Response.json({ error: `Problem must be ${MIN_PROBLEM}–${MAX_PROBLEM} characters` }, { status: 400 });
  try {
    return Response.json(await runHive(sb, user.id, problem, req.signal));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: req.signal.aborted ? 499 : 503 });
  }
}
