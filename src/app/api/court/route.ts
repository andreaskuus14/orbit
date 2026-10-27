import { requireUser } from "@/lib/supabase/server";
import { courtCost, keepCourt, runCourt } from "@/lib/court";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fail = (e: unknown, aborted = false) => Response.json({ error: e instanceof Error ? e.message : "Courtroom failed" }, { status: aborted ? 499 : (e as { status?: number })?.status ?? 503 });

/** ?options=2|3 → what a run would cost (calls, model, usage so far, hold). Shown before he clicks. */
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(courtCost(Number(new URL(req.url).searchParams.get("options")) || 2));
}

/** {question, options?, weights?} → the courtroom result (his click only) | {action:"keep", id, weights?} → {memoryId}. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (b?.action === "keep") return Response.json({ memoryId: await keepCourt(sb, user.id, b.id, b.weights) });
    return Response.json(await runCourt(sb, user.id, b, req.signal));
  } catch (e) { return fail(e, req.signal.aborted); }
}
