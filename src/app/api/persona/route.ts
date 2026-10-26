import { requireUser } from "@/lib/supabase/server";
import { decideProposal, personaView, savePersona } from "@/lib/persona";
import { LABELS, VOICES, previewLine } from "@/lib/persona-pure";

// Profile → ORBIT's character: sliders, Kokoro voice, the pending "too long" proposal. Local file only (persona.ts).
const fail = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "Persona failed" }, { status: 500 });
const view = async (userId: string) => { const v = await personaView(userId); return Response.json({ ...v, voices: VOICES, labels: LABELS, preview: previewLine(v.persona) }); };

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  try { return await view(user.id); } catch (e) { return fail(e); }
}

/** {warmth?, humour?, directness?, verbosity?, voice?} saves (bad values keep the old ones); {decision:"keep"|"reject"} answers the proposal. */
export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  try {
    if (b.decision === "keep" || b.decision === "reject") {
      const err = await decideProposal(user.id, b.decision === "keep");
      if (err) return Response.json({ error: err }, { status: 409 });
    } else await savePersona(user.id, b);
    return await view(user.id);
  } catch (e) { return fail(e); }
}
