import { requireUser } from "@/lib/supabase/server";
import { rewind } from "@/lib/when";

export const dynamic = "force-dynamic";

// MEMORY → Rewind. GET ?q=<time phrase> → that period's timeline (journal never included).
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  try { return Response.json(await rewind(sb, user.id, q)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Rewind failed" }, { status: 500 }); }
}
