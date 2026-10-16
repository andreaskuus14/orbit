import { requireUser } from "@/lib/supabase/server";
import { startClipQueue } from "@/lib/clips/factory";
import { actOnPick, scoutFail as fail, scoutView } from "@/lib/clips/scout";

export const dynamic = "force-dynamic";

// Act on a scout pick: { videoId, action: "clip" (download → make clips, like Add from link) | "dismiss" (never suggested again) }.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as { videoId?: unknown; action?: unknown } | null;
  try { await actOnPick(b?.videoId, b?.action); return Response.json(await scoutView()); } catch (e) { return fail(e); }
}
