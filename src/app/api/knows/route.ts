import { requireUser } from "@/lib/supabase/server";
import { knowsView } from "@/lib/knows";

// GET → {groups, ctx, missing}: "What ORBIT knows about you" (knows.ts). Read-only and model-free; edits go to each store's own route.
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await knowsView(sb, user.id)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't read what ORBIT knows" }, { status: 500 }); }
}
