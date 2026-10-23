import { requireUser } from "@/lib/supabase/server";
import { getWeekly } from "@/lib/weekly";

export const dynamic = "force-dynamic";

/** GET: the weekly review (stored data only, no AI call). */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  return Response.json(await getWeekly(sb));
}
