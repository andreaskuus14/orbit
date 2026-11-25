import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { getContinueWork } from "@/lib/work-continuation";

async function GET_() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  return Response.json(await getContinueWork(sb, user.id), { headers: { "Cache-Control": "private, no-store" } });
}
export const GET = guard("continue", GET_);
