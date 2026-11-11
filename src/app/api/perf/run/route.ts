// Scripted perf runs (PerfRun.tsx, ?perfrun=1): POST saves one run to <data dir>/perf-runs/<ms>.json; GET returns the
// recent runs, each compared with a comparable previous run (ANALYTICS PERF card). Owner only.
import { requireUser } from "@/lib/supabase/server";
import { listRuns, saveRun } from "@/lib/perf-runs";
import { cleanRun, compareRuns, previousOf } from "@/lib/perf-run-pure";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const text = await req.text();
  if (text.length > 64_000) return Response.json({ error: "Too large" }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* invalid below */ }
  const run = cleanRun(body, Date.now());
  if (!run) return Response.json({ error: "Invalid run" }, { status: 400 });
  await saveRun(run);
  return Response.json({ ok: true, at: run.at });
}

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const runs = await listRuns(30);
  return Response.json({ runs: runs.slice(-8).reverse().map((r) => ({ at: r.at, label: r.label, gpu: r.gpu, hidden: r.hidden, rows: compareRuns(previousOf(runs, r), r) })) });
}
