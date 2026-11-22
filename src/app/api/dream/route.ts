import { requireUser } from "@/lib/supabase/server";
import { readDreamReport, undoDream } from "@/lib/dream";

// Dream mode (dream.ts): GET today's report (connections + links to the items); POST {undo: true} reverses every change of the night.
export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  return Response.json({ report: (await readDreamReport(user.id).catch(() => undefined)) ?? null });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  if (body?.undo !== true) return Response.json({ error: "Unknown action" }, { status: 400 });
  const r = await undoDream(sb, user.id);
  return Response.json(r, { status: r.ok ? 200 : r.undone ? 207 : 409 });
}
