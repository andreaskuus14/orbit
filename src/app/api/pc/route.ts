import { requireUser } from "@/lib/supabase/server";
import { confirmPc, pendingPc } from "@/lib/jarvis";

export const dynamic = "force-dynamic";

// Level-3 PC actions waiting for the owner's OK (pc-policy-pure): GET lists them; POST {id, allow} is his click.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ pending: pendingPc() });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; allow?: unknown } | null;
  if (!b || typeof b.id !== "string" || typeof b.allow !== "boolean") return Response.json({ error: "Expected {id, allow}" }, { status: 400 });
  const r = await confirmPc(b.id, b.allow, "click");
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
