import { requireUser } from "@/lib/supabase/server";
import { parseRunId } from "@/lib/eval-core-pure";

/** `npm run eval -- --cleanup <runId|all>`: {cleanup: runId | "all"} deletes only the data eval runs tagged (eval-run.ts). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => ({}));
  const run = b?.cleanup === "all" ? "all" : parseRunId(b?.cleanup);
  if (!run) return Response.json({ error: 'cleanup must be an eval run id (ev-YYYYMMDD-xxxx) or "all"' }, { status: 400 });
  try { return Response.json({ run, deleted: await (await import("@/lib/eval-run")).cleanupEvalRun(sb, user.id, run) }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "cleanup failed" }, { status: 500 }); }
}
