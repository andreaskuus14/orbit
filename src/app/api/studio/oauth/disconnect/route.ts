import { requireUser } from "@/lib/supabase/server";
import { disconnect } from "@/lib/yt-oauth";

export async function POST() {
  const { res } = await requireUser();
  if (res) return res;
  try {
    await disconnect();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Couldn't remove the saved YouTube connection" }, { status: 500 });
  }
}
