import { requireUser } from "@/lib/supabase/server";
import { addCreator, scoutFail as fail, scoutView } from "@/lib/clips/scout";

export const dynamic = "force-dynamic";

// Add a creator to the watchlist: { input: @handle | name | channel or video link }, resolved via the Data API (1-2 units); returns { added: { title, subscribers, already } }. Remove/toggle: PATCH ../ { watchlist }.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { input?: unknown } | null;
  try { const added = await addCreator(b?.input); return Response.json({ ...(await scoutView()), added }); } catch (e) { return fail(e); }
}
