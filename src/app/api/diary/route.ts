import { requireUser } from "@/lib/supabase/server";
import { diaryView } from "@/lib/diary";

export const dynamic = "force-dynamic";

/** GET ?q=&page= → ORBIT's log (its own nightly diary), newest first, 10 per page. */
export async function GET(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const u = new URL(req.url);
  try { return Response.json(await diaryView(user.id, u.searchParams.get("q") ?? "", Number(u.searchParams.get("page")) || 1)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Diary failed" }, { status: 500 }); }
}
