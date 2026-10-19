import { requireUser } from "@/lib/supabase/server";
import { getSources, reachScan, saveSources } from "@/lib/reach";
import { cleanSources, reachCards } from "@/lib/reach/pure";

export const dynamic = "force-dynamic";

// Reach (anonymous Reddit/Kick/Bluesky + Twitch Helix with the user's own key). GET → cached scan + hints + lists + Herald cards
// (starts a background scan when older than 3 h). POST { reddit?, kick?, twitch?, bsky? } → replace those lists (validated).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const scan = reachScan();
  return Response.json({ ...scan, items: scan.items.slice(0, 80), cards: reachCards(scan.items), sources: await getSources() });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const next = cleanSources(await req.json().catch(() => null), await getSources());
  if (typeof next === "string") return Response.json({ error: next }, { status: 400 });
  try { await saveSources(next); } catch (e) { console.error("[reach] save:", e); return Response.json({ error: "Couldn't save the Reach sources file" }, { status: 500 }); }
  return Response.json({ sources: next });
}
