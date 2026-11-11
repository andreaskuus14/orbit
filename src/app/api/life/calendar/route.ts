import { requireUser } from "@/lib/supabase/server";
import { calEnv, calExpired, calendarEvents, disconnectCal } from "@/lib/gcal";
import { calDays, calFailure } from "@/lib/gcal-pure";

export const dynamic = "force-dynamic";

/** LIFE calendar card: { configured, connected, expired?, events?, error? } (read-only, ?days=1..14, default 7). */
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const configured = !!calEnv();
  try {
    const events = await calendarEvents(calDays(new URL(req.url).searchParams.get("days")));
    return Response.json({ configured, connected: !!events, ...(events ? { events } : (await calExpired()) && { expired: true }) });
  } catch (e) {
    const f = calFailure(e);
    return Response.json({ configured, connected: !f.expired, ...(f.expired && { expired: true }), error: f.text });
  }
}

/** Body { action: "disconnect" }: revoke at Google and forget the local grant. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if ((await req.json().catch(() => null))?.action !== "disconnect") return Response.json({ error: "action must be disconnect" }, { status: 400 });
  try { await disconnectCal(); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "Couldn't remove the saved calendar connection" }, { status: 500 }); }
}
