import { requireUser } from "@/lib/supabase/server";
import { gatherNeeds } from "@/lib/needs-you";
import { parseLang } from "@/lib/i18n-pure";

export const dynamic = "force-dynamic";

/** GET ?lang=et → the Needs-you inbox (read only: every action goes through its own existing route). */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json({ items: await gatherNeeds(sb, user.id, Date.now(), parseLang(new URL(req.url).searchParams.get("lang"))) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Needs you failed" }, { status: 500 }); }
}
