import { requireUser } from "@/lib/supabase/server";
import { learnView } from "@/lib/clips/learn";

export const dynamic = "force-dynamic";

// "What ORBIT learned": GET = the analysis (refreshes published clips' stats first when 6 h have passed). Logic: src/lib/clips/learn.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await learnView()); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't load what ORBIT learned" }, { status: 500 }); }
}
