import { requireUser } from "@/lib/supabase/server";
import { calEnv, calendarEvents, disconnectCal } from "@/lib/gcal";
import { calDays } from "@/lib/gcal-pure";

export const dynamic = "force-dynamic";

/** LIFE calendar card: { configured, connected, events? } (read-only, ?days=1..14, default 7). */
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const configured = !!calEnv();
  try {
    const events = await calendarEvents(calDays(new URL(req.url).searchParams.get("days")));
    return Response.json({ configured, connected: !!events, ...(events && { events }) });
  } catch (e) {
    return Response.json({ configured, connected: true, error: e instanceof Error ? e.message.slice(0, 160) : "Couldn't read the calendar" });
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
