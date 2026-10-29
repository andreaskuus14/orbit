import { requireUser } from "@/lib/supabase/server";
import { actMission, createMission, listMissions, setBaseline } from "@/lib/missions";
import { pilotMission, RESEARCH_PILOT } from "@/lib/research-pilot-pure";
import { getCheckpoint } from "@/lib/checkpoint";
import { checkpointPrompt } from "@/lib/checkpoint-pure";

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

/** { objective, constraints?, steps } → new mission; { workflow: "research-pilot", topic, chatId? } → the G01 saved workflow;
 *  { action: "pause"|"resume"|"cancel"|"retry", id } → owner control; { action: "baseline", id, minutes } → owner's manual-minutes baseline. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  try {
    if (body?.action === "baseline") {
      const r = typeof body.id === "string" ? await setBaseline(sb, user.id, body.id, body.minutes) : { error: "id is required" };
      return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r);
    }
    if (body?.action !== undefined) {
      if (!["pause", "resume", "cancel", "retry", "accept"].includes(body.action) || typeof body.id !== "string") return Response.json({ error: "Unknown action" }, { status: 400 });
      const r = await actMission(sb, user.id, body.id, body.action);
      return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r);
    }
    if (body?.workflow === RESEARCH_PILOT) {
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
      if (topic.length < 3) return Response.json({ error: "Say what to research" }, { status: 400 });
      const cp = typeof body.chatId === "string" && body.chatId ? checkpointPrompt(await getCheckpoint(user.id, body.chatId)) : "";
      const r = await createMission(sb, user.id, { ...pilotMission(topic, cp), lang: body.lang });
      return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r, { status: 201 });
    }
    const r = await createMission(sb, user.id, body);
    return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
