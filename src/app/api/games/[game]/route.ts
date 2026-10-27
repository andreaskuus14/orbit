import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { gameById } from "@/games/registry";
import { planPut, readStored, tombstone } from "@/games/saves";

// Game Lab persistence: the signed-in user's save and settings for one game. RLS scopes rows to the owner;
// everything written is validated here first, so a tampered client can't store malformed saves or settings.
// Saves use the gen/rev envelope in src/games/saves.ts: stale or concurrent writes get 409 instead of clobbering.
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
  const st = readStored(data?.save, game.validateSave);
  return Response.json({
    save: st.data, // a damaged save is returned as-is so the player can download it
    damaged: st.damaged,
    gen: st.gen,
    rev: st.rev,
    settings: vs?.ok ? vs.settings : game.defaults,
    settingsReset: !!vs && !vs.ok,
    updatedAt: data?.updated_at ?? null,
  });
}

/** Body: { save, gen, rev } to store a save (gen/rev as last read or written), { settings } to store settings ({} = defaults). */
export async function PUT(req: Request, { params }: Ctx) {
  const h = req.headers; // the middleware matcher skips paths ending in .png etc., so check here too
  if (crossSiteBlocked("PUT", "/api/games", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const game = gameById((await params).game);
  if (!game) return Response.json({ error: "Unknown game" }, { status: 404 });
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Save is too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });

  if ("save" in body) {
    const { data: row, error } = await sb.from("game_saves").select("save, updated_at").eq("game", game.id).maybeSingle();
    if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
    const plan = planPut(row?.save, body, game.validateSave);
    if (!plan.ok) return Response.json({ error: plan.error }, { status: plan.status });
    const updated_at = new Date().toISOString();
    if (row) {
      // Conditional: only if nothing was written since we read it (same pattern as /api/devworld).
      const { data: hit, error: e2 } = await sb.from("game_saves").update({ save: plan.save, updated_at }).eq("game", game.id).eq("updated_at", row.updated_at).select("game");
      if (e2) return Response.json({ error: missingTable(e2.message) }, { status: 500 });
      if (!hit?.length) return Response.json({ error: "Your save changed while saving. Reload to keep saving." }, { status: 409 });
    } else {
      const { error: e2 } = await sb.from("game_saves").insert({ user_id: user.id, game: game.id, save: plan.save, updated_at });
      if (e2?.code === "23505") return Response.json({ error: "Your save changed while saving. Reload to keep saving." }, { status: 409 });
      if (e2) return Response.json({ error: missingTable(e2.message) }, { status: 500 });
    }
    return Response.json({ ok: true, gen: plan.save.gen, rev: plan.save.rev, updatedAt: updated_at });
  }
  if ("settings" in body) {
    const v = game.validateSettings(body.settings);
    if (!v.ok) return Response.json({ error: "Invalid settings", errors: v.errors }, { status: 400 });
    // No updated_at here: it is the save's write marker (conditional writes and "last saved" both read it).
    const { error } = await sb.from("game_saves").upsert({ user_id: user.id, game: game.id, settings: v.settings }, { onConflict: "user_id,game" });
    if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
    return Response.json({ ok: true, settings: v.settings });
  }
  return Response.json({ error: "Nothing to save" }, { status: 400 });
}

/** Explicit reset: replaces the save with a tombstone of the next generation (so in-flight older saves are refused), keeps settings. */
export async function DELETE(req: Request, { params }: Ctx) {
  const h = req.headers; // the middleware matcher skips paths ending in .png etc., so check here too
  if (crossSiteBlocked("DELETE", "/api/games", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const game = gameById((await params).game);
  if (!game) return Response.json({ error: "Unknown game" }, { status: 404 });
  const { data: row, error } = await sb.from("game_saves").select("save").eq("game", game.id).maybeSingle();
  if (error) return Response.json({ error: missingTable(error.message) }, { status: 500 });
  const save = tombstone(row?.save);
  const { error: e2 } = await sb.from("game_saves").upsert({ user_id: user.id, game: game.id, save, updated_at: new Date().toISOString() }, { onConflict: "user_id,game" });
  if (e2) return Response.json({ error: missingTable(e2.message) }, { status: 500 });
  return Response.json({ ok: true, gen: save.gen, rev: 0 });
}
