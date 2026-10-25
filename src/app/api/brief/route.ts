import { requireUser } from "@/lib/supabase/server";
import { getBrief, setBriefLife, snoozeItem } from "@/lib/brief";
import { ledgerIssue } from "@/lib/ledger-pure";
import { emit } from "@/lib/claude";
import { allows } from "@/lib/autonomy";

/** ORBIT's morning brief (brief.ts): items, card rows and the spoken words (polished by at most one fast-model call a day). */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  if (!allows("brief", "background", { stopAll: false }).ok) return Response.json({ off: true }); // Profile → Autonomy: brief Off
  try {
    return Response.json(await getBrief(sb, user.id));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Brief failed" }, { status: 500 });
  }
}

/** { event: "shown", day, items, spoken } → ledger brief.shown (ids only) · { snooze: id } → hidden until tomorrow · { life: boolean } → LIFE opt-in. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { event?: unknown; day?: unknown; items?: unknown; spoken?: unknown; snooze?: unknown; life?: unknown } | null;
  if (b?.event === "shown") {
    const data = { day: b.day, items: b.items, spoken: b.spoken };
    const issue = ledgerIssue("brief.shown", "core", data);
    if (issue) return Response.json({ error: issue }, { status: 400 });
    await emit(sb, user.id, "brief.shown", "core", data);
    return Response.json({ ok: true });
  }
  if (typeof b?.snooze === "string" && b.snooze.trim() && b.snooze.length <= 128) { await snoozeItem(user.id, b.snooze); return Response.json({ ok: true }); }
  if (typeof b?.life === "boolean") { await setBriefLife(user.id, b.life); return Response.json({ ok: true }); }
  return Response.json({ error: "Expected event, snooze or life" }, { status: 400 });
}
