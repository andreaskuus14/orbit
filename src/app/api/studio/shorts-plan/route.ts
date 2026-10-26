import { requireUser } from "@/lib/supabase/server";
import { approveBatch, prepShorts, setShortsTarget, shortsPlanView } from "@/lib/clips/shorts-plan";

export const dynamic = "force-dynamic";

// Shorts autopilot v2. Spending only ever starts from action "approve" with the exact batch ids and total the board showed (ORBIT rule 6).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await shortsPlanView());
}

/** Body: {action:"prep"} (pick + script + price now, no spend) | {action:"approve", ids, credits} | {action:"target", target}. */
export async function POST(req: Request) {
  const { res, user } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  try {
    if (b.action === "prep") { void prepShorts(user.id).catch((e) => console.error("[orbit] shorts plan:", e)); return Response.json({ started: true }, { status: 202 }); } // minutes of Claude work
    if (b.action === "target") { await setShortsTarget(b.target); return Response.json(await shortsPlanView()); }
    if (b.action !== "approve") return Response.json({ error: "action must be prep, approve or target" }, { status: 400 });
    const out = await approveBatch(b.ids, b.credits);
    return typeof out === "string" ? Response.json({ error: out }, { status: 409 }) : Response.json({ batch: out });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
