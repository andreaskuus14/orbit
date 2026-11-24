import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { confirmPc, pendingPc } from "@/lib/jarvis";

export const dynamic = "force-dynamic";

// Level-3 PC actions waiting for the owner's OK (pc-policy-pure): GET lists them; POST {id, allow} is his click.
async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ pending: pendingPc() });
}

async function POST_(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; allow?: unknown } | null;
  if (!b || typeof b.id !== "string" || typeof b.allow !== "boolean") return Response.json({ error: "Expected {id, allow}" }, { status: 400 });
  const r = await confirmPc(b.id, b.allow, "click");
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
export const GET = guard("pc", GET_);
export const POST = guard("pc", POST_);
