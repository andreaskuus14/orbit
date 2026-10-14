import { requireUser } from "@/lib/supabase/server";
import { runPulse, type Focus } from "@/lib/pulse";

export const maxDuration = 300;

/** Generate a briefing now (the scheduled ones run in the background). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const focus: Focus = ["world", "mine"].includes(body.focus) ? body.focus : "all";
  try {
    const { briefing, ingest } = await runPulse(sb, user.id, "manual", focus);
    return Response.json({ briefing, ingest });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Pulse failed" }, { status: 502 });
  }
}
