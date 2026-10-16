import { requireUser } from "@/lib/supabase/server";
import { scoutFail as fail } from "@/lib/clips/scout";
import { theater } from "@/lib/watch";

export const dynamic = "force-dynamic";

// THEATER: GET ?creator=jynxzi[&shorts=1] → { channel, videos } (the creator's 3 newest uploads; 2-3 YouTube units, cached 10 min).
// ?topic=cs2[&shorts=1] (or an unknown creator with &fallback=1) → { topic, videos[, note] } (12 popular from the last 14 days; 101 units, cached 30 min).
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  try { return Response.json(await theater(q.get("creator"), q.get("topic"), q.get("shorts") === "1", q.get("fallback") === "1")); } catch (e) { return fail(e); }
}
