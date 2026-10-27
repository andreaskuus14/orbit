import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { NotesError, draftNotes, economyView, saveEconomy } from "@/lib/economy";
import { MAX_CHANGES, MAX_TABLE, MAX_VOICE } from "@/lib/economy-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Game dev copilot (GAME DEV → Economy). GET: saved table, voice example, last notes time.
// POST {action:"save", table, voice} | {action:"notes", game, changes} (one fast-model call). Nothing is published to Roblox.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  return Response.json(await economyView(user.id));
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/economy", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (b?.action === "save") {
    if (!text(b.table, MAX_TABLE) || !text(b.voice, MAX_VOICE)) return fail(`table (max ${MAX_TABLE}) and voice (max ${MAX_VOICE}) must be text`);
    await saveEconomy(user.id, b.table as string, b.voice as string);
    return Response.json(await economyView(user.id));
  }
  if (b?.action === "notes") {
    if (!text(b.changes, MAX_CHANGES) || !(b.changes as string).trim()) return fail(`changes must be text of at most ${MAX_CHANGES} characters`);
    try { return Response.json(await draftNotes(sb, user.id, typeof b.game === "string" ? b.game.slice(0, 80) : "Pet Simulator", b.changes as string)); }
    catch (e) { return fail(e instanceof Error ? e.message : String(e), e instanceof NotesError ? 409 : 502); }
  }
  return fail("action must be save or notes");
}
