import { requireUser } from "@/lib/supabase/server";
import { getMorning, getSince } from "@/lib/morning";
import { parseSince } from "@/lib/morning-pure";

/** The "Good morning" briefing: card sections plus a template-built spoken version (no AI call).
 *  ?since=<ms> adds the "since you left" section; with &recap=1 only that section is gathered and returned. */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  void import("@/lib/goals").then((g) => g.resumeGoals(sb, user.id)).catch(() => {}); // opening ORBIT is one of the events that advances goals
  const q = new URL(req.url).searchParams, now = Date.now(), from = parseSince(q.get("since"), now);
  try {
    if (q.get("recap") === "1") return from === null ? Response.json({ error: "since is required" }, { status: 400 }) : Response.json({ since: await getSince(sb, from, now) });
    return Response.json(await getMorning(sb, user.id, now, from));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Briefing failed" }, { status: 500 });
  }
}
