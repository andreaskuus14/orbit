import { requireUser } from "@/lib/supabase/server";
import { getOverview } from "@/lib/business-overview";

export const dynamic = "force-dynamic";

/** GET → the BUSINESS overview (business-overview-pure). Read only; the monthly target is saved through /api/business/money {action:"settings", revenueTarget}. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await getOverview(sb, user.id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Overview failed" }, { status: 500 }); }
}
