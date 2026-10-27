import { requireUser } from "@/lib/supabase/server";
import { buildNow, listEpisodes } from "@/lib/episodes";
import { episodeView } from "@/lib/episodes-pure";

export const dynamic = "force-dynamic";

/** GET: his episodes (MEMORY → Episodes), newest first by when they happened. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json({ episodes: (await listEpisodes(sb, user.id)).map(episodeView) }); }
  catch (e) { console.error("[episodes] list failed", e); return Response.json({ error: "Could not load episodes" }, { status: 500 }); }
}

/** POST: build now instead of waiting for tonight (same builder, no model call). */
export async function POST() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json({ added: await buildNow(sb, user.id) }); }
  catch (e) { console.error("[episodes] build failed", e); return Response.json({ error: "Could not build episodes (is migration 0018_episodes.sql applied?)" }, { status: 500 }); }
}
