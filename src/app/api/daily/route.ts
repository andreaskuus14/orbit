import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { dailyRuns } from "@/lib/daily";

/** Today's three daily workflows (brief, clips, leads) as outcome states with their evidence (daily-pure.ts). Read-only. */
async function GET_() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  return Response.json(await dailyRuns(sb, user.id));
}
export const GET = guard("daily", GET_);
