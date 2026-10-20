import { requireUser } from "@/lib/supabase/server";
import { getContinueWork } from "@/lib/work-continuation";

export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  return Response.json(await getContinueWork(sb, user.id), { headers: { "Cache-Control": "private, no-store" } });
}
