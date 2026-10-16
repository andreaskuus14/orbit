import { requireUser } from "@/lib/supabase/server";
import { getMorning } from "@/lib/morning";

/** The "Good morning" briefing: card sections plus a template-built spoken version (no AI call). */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  try {
    return Response.json(await getMorning(sb));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Briefing failed" }, { status: 500 });
  }
}
