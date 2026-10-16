import { requireUser } from "@/lib/supabase/server";
import { scoutFail as fail } from "@/lib/clips/scout";
import { latestVideos } from "@/lib/watch";

export const dynamic = "force-dynamic";

// THEATER: GET ?creator=jynxzi[&shorts=1] → { channel, videos } (the creator's 3 newest uploads; 2-3 YouTube units, cached 10 min).
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  try { return Response.json(await latestVideos(q.get("creator"), q.get("shorts") === "1")); } catch (e) { return fail(e); }
}
