import { requireUser } from "@/lib/supabase/server";
import { listFacts, editFact, forgetFact, FactsMissing, FactConflict, FACTS_MISSING_MSG } from "@/lib/facts";
import { validateFact } from "@/lib/facts-pure";

function fail(e: unknown) {
  if (e instanceof FactsMissing) return Response.json({ available: false, error: FACTS_MISSING_MSG }, { status: 503 });
  if (e instanceof FactConflict) return Response.json({ error: e.message }, { status: 409 });
  console.error("[facts] request failed", e); // DB detail stays in the log
  return Response.json({ error: "Could not update beliefs. Try again." }, { status: 500 });
}

/** What ORBIT believes: {available, facts} (current + superseded, newest first). {available:false} until migration 0008. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    return Response.json({ available: true, facts: await listFacts(sb, user.id) });
  } catch (e) {
    if (e instanceof FactsMissing) return Response.json({ available: false, message: FACTS_MISSING_MSG, facts: [] });
    return fail(e);
  }
}

/** {action:"edit", id, subject, statement} | {action:"forget", id}. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = Object(await req.json().catch(() => ({})));
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    if (body.action === "forget") { await forgetFact(sb, user.id, id); return Response.json({ ok: true }); }
    if (body.action === "edit") {
      const v = validateFact(body.subject, body.statement);
      if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
      return Response.json({ fact: await editFact(sb, user.id, id, v.subject, v.statement) });
    }
    return Response.json({ error: 'action must be "edit" or "forget"' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
