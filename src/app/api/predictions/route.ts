import { requireUser } from "@/lib/supabase/server";
import { predictionsView } from "@/lib/predict";

export const dynamic = "force-dynamic";

/** GET: open guesses by item id (for the approval cards), this week's and this month's score, Do & report suggestions. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await predictionsView(sb, user.id)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Predictions failed" }, { status: 500 }); }
}
