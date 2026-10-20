import { youtubeQuotaView } from "@/lib/youtube-quota";
import { requireUser } from "@/lib/supabase/server";
import { setUsageSettings, usageView } from "@/lib/usage-meter";

export const dynamic = "force-dynamic";

// Max-plan usage meter: GET rolling 5 h / 7 day stats by purpose + settings; POST {calls5h?, tokens5h?, warnPct?, clearLimit?}.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ ...usageView(), youtube: youtubeQuotaView() });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON body required" }, { status: 400 });
  const err = setUsageSettings(b);
  return err ? Response.json({ error: err }, { status: 400 }) : Response.json({ ...usageView(), youtube: youtubeQuotaView() });
}
