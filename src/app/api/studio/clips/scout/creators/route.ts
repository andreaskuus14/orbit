import { requireUser } from "@/lib/supabase/server";
import { addCreator, scoutFail as fail, scoutView } from "@/lib/clips/scout";

export const dynamic = "force-dynamic";

// Add a creator to the watchlist: { input: channel URL | @handle | UC… id }, resolved via the Data API (1 unit). Remove/toggle: PATCH ../ { watchlist }.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { input?: unknown } | null;
  try { await addCreator(b?.input); return Response.json(await scoutView()); } catch (e) { return fail(e); }
}
