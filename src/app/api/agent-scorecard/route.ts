import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { blocked, runScorecard, scorecardView } from "@/lib/agent-replay";

export const dynamic = "force-dynamic";

// ANALYTICS agent scorecard: GET the monthly summary + call estimate; POST starts a run now (it continues in the background).
async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await scorecardView());
}

async function POST_() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const why = (await scorecardView()).running ? "A scorecard run is already in progress" : blocked(false);
  if (why) return Response.json({ error: why }, { status: 409 });
  // A run takes up to ~50 min: the service client doesn't depend on the browser session staying fresh.
  void runScorecard(adminClient() ?? sb, user.id, "manual").then((why) => { if (why) console.warn("[orbit] scorecard not run:", why); });
  return Response.json(await scorecardView(), { status: 202 });
}
export const GET = guard("agent-scorecard", GET_);
export const POST = guard("agent-scorecard", POST_);
