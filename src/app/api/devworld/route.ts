import { requireUser } from "@/lib/supabase/server";
import { SEED_WORLD, validateDevWorld } from "@/lib/devworld-pure";

// Game-dev world: the user's games and bug trackers, one game_saves row (game = "devworld"; not a Game Lab game).
const GAME = "devworld";
const MAX_BODY = 200_000; // bytes; the table caps the stored jsonb at 256 KB

function missingTable(msg: string) {
  return /game_saves/.test(msg) && /does not exist|schema cache/i.test(msg)
    ? "Game saves aren't set up yet: run supabase/migrations/0005_orbit_games.sql in Supabase."
    : msg;
}

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("game_saves").select("save, updated_at").eq("game", GAME).maybeSingle();
  if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
  if (!data?.save) return Response.json({ world: SEED_WORLD, seeded: true, updatedAt: null });
  // Validated on write; re-check so a hand-edited row can't break the UI. Don't fall back to the seed: the next save would overwrite it.
  const v = validateDevWorld(data.save);
  if (!v.ok) return Response.json({ error: `Stored dev world is invalid: ${v.error}` }, { status: 500 });
  return Response.json({ world: v.world, seeded: false, updatedAt: data.updated_at });
}

/** Body: { world, base } replaces the whole world. base = the updatedAt the client last saw (null = never saved);
 *  a stale base gets 409 so a second tab/device can't silently overwrite newer changes. */
export async function PUT(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return Response.json({ error: "Dev world is too large: delete some fixed bugs or trim long notes." }, { status: 413 });
  let body: { world?: unknown; base?: unknown };
  try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const v = validateDevWorld(body?.world);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const updated_at = new Date().toISOString();
  const stale = () => Response.json({ error: "Changed in another tab or device — reloaded the latest version." }, { status: 409 });
  if (typeof body.base === "string") {
    // A row whose save was nulled counts as existing: the base check still applies.
    const { data, error } = await sb.from("game_saves").update({ save: v.world, updated_at }).eq("game", GAME).eq("updated_at", body.base).select("game");
    if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
    if (!data?.length) return stale();
  } else {
    const { error } = await sb.from("game_saves").insert({ user_id: user.id, game: GAME, save: v.world, updated_at });
    if (error?.code === "23505") return stale(); // first save raced another tab
    if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
  }
  return Response.json({ ok: true, world: v.world, updatedAt: updated_at });
}
