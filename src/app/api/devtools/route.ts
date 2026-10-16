import { requireUser } from "@/lib/supabase/server";
import { FavError, addFavourite, getFavourites, getTrends, removeFavourite, searchSounds, whyTrending } from "@/lib/devtools";
import { cleanFavourite, cleanQuery } from "@/lib/devtools-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// DevWorld game-dev tools. GET ?sounds=<q> → { sounds } (Openverse) | ?favs=1 → { favourites } | ?trends=1 → Trend Radar.
// POST { action: "fav", sound } | { action: "unfav", id } | { action: "why" } (AI patterns for the current trend list).
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.has("sounds")) {
      const q = cleanQuery(sp.get("sounds"));
      return q ? Response.json({ sounds: await searchSounds(q) }) : bad("Search must be 1–100 characters");
    }
    if (sp.get("favs") === "1") return Response.json({ favourites: await getFavourites() });
    if (sp.get("trends") === "1") return Response.json(await getTrends());
    return bad("Use ?sounds=, ?favs=1 or ?trends=1");
  } catch (e) { return e instanceof FavError ? bad(e.message, e.status) : bad(`Couldn't load: ${msg(e)}`, 502); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; sound?: unknown; id?: unknown } | null;
  try {
    switch (b?.action) {
      case "fav": {
        const s = cleanFavourite(b.sound);
        return s ? Response.json({ favourites: await addFavourite(s) }) : bad("Invalid sound");
      }
      case "unfav":
        return typeof b.id === "string" && b.id.length <= 64 ? Response.json({ favourites: await removeFavourite(b.id) }) : bad("Missing id");
      case "why":
        return Response.json(await whyTrending(sb, user.id));
      default:
        return bad("Unknown action");
    }
  } catch (e) { return bad(msg(e), e instanceof FavError ? e.status : 502); }
}
