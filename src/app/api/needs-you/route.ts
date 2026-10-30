import { requireUser } from "@/lib/supabase/server";
import { gatherNeeds, NEED_SNOOZE } from "@/lib/needs-you";
import { snoozeItem } from "@/lib/brief";
import { parseLang } from "@/lib/i18n-pure";

export const dynamic = "force-dynamic";

/** GET ?lang=et → the Needs-you inbox (read only: every action goes through its own existing route). */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json({ items: await gatherNeeds(sb, user.id, Date.now(), parseLang(new URL(req.url).searchParams.get("lang"))) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Needs you failed" }, { status: 500 }); }
}

/** { snooze: ref, reason } → hidden until tomorrow, with his reason (brief.json, ids only). */
export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { snooze?: unknown; reason?: unknown } | null;
  const ref = typeof b?.snooze === "string" ? b.snooze.trim() : "", reason = typeof b?.reason === "string" ? b.reason.trim() : "";
  if (!ref || ref.length > 120 || !reason || reason.length > 200) return Response.json({ error: "snooze and reason are required" }, { status: 400 });
  await snoozeItem(user.id, NEED_SNOOZE + ref, Date.now(), reason);
  return Response.json({ ok: true });
}
