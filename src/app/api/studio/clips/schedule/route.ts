import { requireUser } from "@/lib/supabase/server";
import { startClipQueue } from "@/lib/clips/factory";
import { batchStatus, freeSlots, readPublishSettings, savePublishSettings, scheduleAll } from "@/lib/clips/publish-schedule";
import { parseSettings } from "@/lib/clips/schedule";
import { YT_UPLOAD_SCOPE, hasScopes } from "@/lib/yt-analytics-pure";
import { readStored } from "@/lib/yt-oauth";

export const dynamic = "force-dynamic";

// Scheduled publishing: GET settings + next free slots + "schedule all" progress; PUT settings; POST schedules every approved clip.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ settings: await readPublishSettings(), next: await freeSlots(3), batch: batchStatus() });
}

export async function PUT(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const s = parseSettings(await req.json().catch(() => null));
  if (typeof s === "string") return Response.json({ error: s }, { status: 400 });
  await savePublishSettings(s);
  return Response.json({ settings: s, next: await freeSlots(3) });
}

export async function POST() {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const s = await readStored();
  if (!s) return Response.json({ error: "Connect YouTube first" }, { status: 409 });
  if (!hasScopes(s.scope, [YT_UPLOAD_SCOPE])) return Response.json({ error: "Reconnect YouTube to allow uploads" }, { status: 403 });
  const batch = await scheduleAll();
  if (typeof batch === "string") return Response.json({ error: batch }, { status: 409 });
  return Response.json({ batch }, { status: 202 });
}
