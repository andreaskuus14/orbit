import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { weekUsage } from "@/lib/clips/story";

export const dynamic = "force-dynamic";

/** The HUD's weekly Higgsfield readout: credits approved this week (Monday 00:00 Tallinn) and ORBIT_HIGGSFIELD_WEEKLY_CAP. */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await weekUsage()); } catch (e) { return Response.json({ error: safeMessage(e, "Failed") }, { status: 500 }); }
}
