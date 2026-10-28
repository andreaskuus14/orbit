import { requireUser } from "@/lib/supabase/server";
import { actMission, createMission, listMissions } from "@/lib/missions";

/** The newest 20 missions, each read together with its chain. A pure read: the scheduler tick and owner actions move them. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    return Response.json({ missions: await listMissions(sb, user.id) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

/** { objective, constraints?, steps } → new mission; { action: "pause"|"resume"|"cancel"|"retry", id } → owner control. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  try {
    if (body?.action !== undefined) {
      if (!["pause", "resume", "cancel", "retry"].includes(body.action) || typeof body.id !== "string") return Response.json({ error: "Unknown action" }, { status: 400 });
      const r = await actMission(sb, user.id, body.id, body.action);
      return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r);
    }
    const r = await createMission(sb, user.id, body);
    return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
