import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { decideHygiene, getHygiene } from "@/lib/memory-hygiene";

export const dynamic = "force-dynamic";

/** GET: this week's hygiene proposals plus the one review queue (MEM05, top 5). MEMORY panel only; no model call. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await getHygiene(sb, user.id)); }
  catch (e) { console.error("[hygiene] failed", e); return Response.json({ error: "Could not check memory hygiene" }, { status: 500 }); }
}

const DECISIONS = ["accepted", "corrected", "snoozed", "dismissed"] as const;
/** POST {key, decision}: records the owner's click (the action itself already ran through the memory/fact routes). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = Object(await req.json().catch(() => ({})));
  const key = typeof body.key === "string" && /^(merge|retract|infer|belief|stale):[0-9a-f:-]{36,80}$/i.test(body.key) ? body.key : null;
  if (!key || !DECISIONS.includes(body.decision)) return Response.json({ error: "key and decision are required" }, { status: 400 });
  await decideHygiene(user.id, key, body.decision);
  await emit(sb, user.id, "memory.hygiene", "memory", { action: key.split(":")[0], decision: body.decision, key });
  return Response.json({ ok: true });
}
