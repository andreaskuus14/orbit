import { requireUser } from "@/lib/supabase/server";
import { BusyError } from "@/lib/claude";
import { SessionError, devSessionIdea, endDevSession, listDevSessions, readSessionShot, summarizeDevSession } from "@/lib/dev-session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GAME DEV session log (roadmap 4.2). GET → { sessions } newest first; GET ?shot=<uuid> → that playtest PNG.
// POST { action: "end", id, summarize? } | { action: "summarize", id } (one fast-model call) | { action: "idea", id } (a "Day N" Short idea in IDEA RADAR).
// Nothing here touches Roblox Studio. CSRF is checked by middleware.
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const shot = new URL(req.url).searchParams.get("shot");
  if (shot !== null) {
    const png = await readSessionShot(user.id, shot);
    return png ? new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } })
      : Response.json({ error: "Screenshot not found" }, { status: 404 });
  }
  try { return Response.json({ sessions: await listDevSessions(sb, user.id) }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't read the session log" }, { status: 500 }); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; summarize?: unknown } | null;
  const id = typeof b?.id === "string" && /^[0-9a-f-]{36}$/.test(b.id) ? b.id : null;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    if (b?.action === "end") return Response.json(await endDevSession(sb, user.id, id, b.summarize === true));
    if (b?.action === "summarize") return Response.json(await summarizeDevSession(sb, user.id, id));
    if (b?.action === "idea") return Response.json(await devSessionIdea(user.id, id));
    return Response.json({ error: "action must be end, summarize or idea" }, { status: 400 });
  } catch (e) {
    const status = e instanceof SessionError ? (/not found/i.test(e.message) ? 404 : 409) : e instanceof BusyError ? 429 : 500;
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status });
  }
}
