import { requireUser } from "@/lib/supabase/server";
import { cancelChain, createChain, getChain, listChains } from "@/lib/chains";

/** ?id=<chainId> → one chain; otherwise the newest 20. Also resumes running chains (after an approval or a restart). */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ chains: await listChains(sb, user.id) });
    const chain = await getChain(sb, user.id, id);
    return chain ? Response.json(chain) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

/** { goal, steps } → start a team chain; { action: "cancel", chainId } → stop it. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  try {
    if (body?.action === "cancel") {
      if (typeof body.chainId !== "string" || !(await cancelChain(sb, body.chainId))) return Response.json({ error: "Only a running or waiting chain can be cancelled" }, { status: 400 });
      return Response.json({ ok: true });
    }
    if (body?.action !== undefined) return Response.json({ error: "Unknown action" }, { status: 400 });
    const r = await createChain(sb, user.id, body);
    return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
