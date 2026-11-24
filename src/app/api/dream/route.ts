import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { readDreamReport, undoDream } from "@/lib/dream";

// Dream mode (dream.ts): GET today's report (connections + links to the items); POST {undo: true} reverses every change of the night.
async function GET_() {
  const { user, res } = await requireUser();
  if (res) return res;
  return Response.json({ report: (await readDreamReport(user.id).catch(() => undefined)) ?? null });
}

async function POST_(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  if (body?.undo !== true) return Response.json({ error: "Unknown action" }, { status: 400 });
  const r = await undoDream(sb, user.id);
  return Response.json(r, { status: r.ok ? 200 : r.undone ? 207 : 409 });
}
export const GET = guard("dream", GET_);
export const POST = guard("dream", POST_);
