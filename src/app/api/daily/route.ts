import { requireUser } from "@/lib/supabase/server";
import { dailyRuns } from "@/lib/daily";

/** Today's three daily workflows (brief, clips, leads) as outcome states with their evidence (daily-pure.ts). Read-only. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  return Response.json(await dailyRuns(sb, user.id));
}
