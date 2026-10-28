import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { decideEntityKey, entitiesView, scanEntities } from "@/lib/entity-graph";

export const dynamic = "force-dynamic";

/** GET: "Same person?" merge suggestions and "Which is right?" questions from the last scan (MEMORY panel). */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await entitiesView(sb, user.id)); }
  catch (e) { console.error("[entities] failed", e); return Response.json({ error: "Could not check memory for conflicts" }, { status: 500 }); }
}

/** POST {key, choice}: "same"|"different" for a merge, an answer's norm or "skip" for a question. Changes no memory or person. */
export async function POST(req: Request) {
  const { user, sb, res } = await requireUser();
  if (res) return res;
  const body = Object(await req.json().catch(() => ({})));
  const key = typeof body.key === "string" && /^(same|contra):[0-9a-f]{8}$/.test(body.key) ? body.key : null;
  const choice = typeof body.choice === "string" && body.choice.length <= 80 ? body.choice : null;
  if (!key || !choice) return Response.json({ error: "key and choice are required" }, { status: 400 });
  const err = await decideEntityKey(user.id, key, choice);
  if (err) return Response.json({ error: err }, { status: 409 });
  if (choice === "same") await scanEntities(sb, user.id).catch((e) => console.error("[entities] rescan", e)); // merged names can now show a question
  await emit(sb, user.id, "memory.entity", "memory", { kind: key.split(":")[0], key }); // ids only, never the answer
  return Response.json({ ok: true });
}
