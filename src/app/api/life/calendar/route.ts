import { requireUser } from "@/lib/supabase/server";
import { calEnv, calExpired, calendarEvents, disconnectCal } from "@/lib/gcal";
import { calDays, calFailure, calRange } from "@/lib/gcal-pure";
import { ICS_MAX_BYTES } from "@/lib/ics-pure";
import { importTimetable, removeTimetable, timetableEvents, timetableInfo } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** LIFE calendar card: { configured, connected, expired?, events?, error? } (read-only, ?days=1..14, default 7). */
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const configured = !!calEnv();
  const days = calDays(new URL(req.url).searchParams.get("days")), r = calRange(Date.now(), days);
  const [tt, lessons] = await Promise.all([timetableInfo().catch(() => null), timetableEvents(Date.parse(r.timeMin), Date.parse(r.timeMax)).catch(() => [])]);
  const merge = (g: { start: string }[] | null | undefined) => [...(g ?? []), ...lessons].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)); // all-day dates parse as UTC midnight: fine for order
  try {
    const events = await calendarEvents(days);
    return Response.json({ configured, connected: !!events, ...(tt && { timetable: tt }), ...(events || lessons.length ? { events: merge(events) } : (await calExpired()) && { expired: true }) });
  } catch (e) {
    const f = calFailure(e);
    return Response.json({ configured, connected: !f.expired, ...(f.expired && { expired: true }), error: f.text, ...(tt && { timetable: tt }), ...(lessons.length && { events: merge(null) }) });
  }
}

/** Body { action: "disconnect" }: revoke at Google and forget the local grant. { action: "timetable", text | url }: import a school .ics (his click in the card). { action: "timetable-remove" }. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (b?.action === "timetable") {
    if ((typeof b.text !== "string" || !b.text) === (typeof b.url !== "string" || !b.url)) return Response.json({ error: "send either text or url" }, { status: 400 });
    if (typeof b.text === "string" && b.text.length > ICS_MAX_BYTES) return Response.json({ error: "That file is too big for a timetable (max 1 MB)" }, { status: 413 });
    const r = await importTimetable(b.url ? { url: b.url } : { text: b.text }).catch(() => "Couldn't save the timetable");
    return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ ok: true, ...r });
  }
  if (b?.action === "timetable-remove") { await removeTimetable().catch(() => {}); return Response.json({ ok: true }); }
  if (b?.action !== "disconnect") return Response.json({ error: "action must be disconnect, timetable or timetable-remove" }, { status: 400 });
  try { await disconnectCal(); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "Couldn't remove the saved calendar connection" }, { status: 500 }); }
}
