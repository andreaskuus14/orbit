import { requireUser } from "@/lib/supabase/server";
import { getWeek } from "@/lib/outcome-week";

export const dynamic = "force-dynamic";

/** GET → the last 7 days: views, leads, replies, revenue, each with its source (outcome-week-pure). Read only. */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await getWeek(sb), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Week failed" }, { status: 500 }); }
}
