import { runDoctor } from "@/lib/doctor";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ORBIT doctor: every health check with a plain-English fix. Signed-in only; returns no secrets (env names only).
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  return Response.json(await runDoctor(sb));
}
