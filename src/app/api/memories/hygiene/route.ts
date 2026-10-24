import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { decideHygiene, getHygiene } from "@/lib/memory-hygiene";

export const dynamic = "force-dynamic";

/** GET: this week's memory hygiene proposals (at most 3, computed on the week's first visit). MEMORY panel only. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await getHygiene(sb, user.id)); }
  catch (e) { console.error("[hygiene] failed", e); return Response.json({ error: "Could not check memory hygiene" }, { status: 500 }); }
}

/** POST {key, decision: "accepted"|"dismissed"}: records the owner's click (the action itself already ran through the memory/fact routes). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = Object(await req.json().catch(() => ({})));
  const key = typeof body.key === "string" && /^(merge|retract):[0-9a-f:-]{36,80}$/i.test(body.key) ? body.key : null;
  if (!key || (body.decision !== "accepted" && body.decision !== "dismissed")) return Response.json({ error: "key and decision are required" }, { status: 400 });
  const err = await decideHygiene(sb, user.id, key, body.decision);
  if (err) return Response.json({ error: err }, { status: 409 });
  await emit(sb, user.id, "memory.hygiene", "memory", { action: key.split(":")[0], decision: body.decision, key });
  return Response.json({ ok: true });
}
