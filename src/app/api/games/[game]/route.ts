import { requireUser } from "@/lib/supabase/server";
import { gameById } from "@/games/registry";

// Game Lab persistence: the signed-in user's save and settings for one game. RLS scopes rows to the owner;
// everything written is validated here first, so a tampered client can't store malformed saves or settings.
type Ctx = { params: Promise<{ game: string }> };
const MAX_BODY = 200_000;

function missingTable(msg: string) {
  return /game_saves/.test(msg) && /does not exist|schema cache/i.test(msg)
    ? "Game saves aren't set up yet: run supabase/migrations/0005_orbit_games.sql in Supabase."
    : msg;
}

export async function GET(_: Request, { params }: Ctx) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const game = gameById((await params).game);
  if (!game) return Response.json({ error: "Unknown game" }, { status: 404 });
  const { data, error } = await sb.from("game_saves").select("save, settings, updated_at").eq("game", game.id).maybeSingle();
  if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
  // Stored settings were validated on write; re-check anyway so a hand-edited row can't break the game.
  const vs = data?.settings ? game.validateSettings(data.settings) : null;
  return Response.json({
    save: data?.save ?? null,
    settings: vs?.ok ? vs.settings : game.defaults,
    settingsReset: !!vs && !vs.ok,
    updatedAt: data?.updated_at ?? null,
  });
}

/** Body: { save } to store a save, { settings } to store settings ({} = defaults). */
export async function PUT(req: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const game = gameById((await params).game);
  if (!game) return Response.json({ error: "Unknown game" }, { status: 404 });
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Save is too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });

  const row: Record<string, unknown> = { user_id: user.id, game: game.id, updated_at: new Date().toISOString() };
  if ("save" in body) {
    const v = game.validateSave(body.save);
    if (!v.ok) return Response.json({ error: `Save rejected: ${v.error}` }, { status: 400 });
    row.save = body.save;
  } else if ("settings" in body) {
    const v = game.validateSettings(body.settings);
    if (!v.ok) return Response.json({ error: "Invalid settings", errors: v.errors }, { status: 400 });
    row.settings = v.settings;
  } else return Response.json({ error: "Nothing to save" }, { status: 400 });

  const { error } = await sb.from("game_saves").upsert(row, { onConflict: "user_id,game" });
  if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
  return Response.json({ ok: true, settings: row.settings, updatedAt: row.updated_at });
}

/** Explicit reset: deletes the save, keeps settings. */
export async function DELETE(_: Request, { params }: Ctx) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const game = gameById((await params).game);
  if (!game) return Response.json({ error: "Unknown game" }, { status: 404 });
  const { error } = await sb.from("game_saves").update({ save: null, updated_at: new Date().toISOString() }).eq("game", game.id);
  if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
  return Response.json({ ok: true });
}
