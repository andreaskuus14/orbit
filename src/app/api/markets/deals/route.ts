import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { addWishItem, closeWish, dealBoard, dismissOffer, huntDeals } from "@/lib/deals";
import { isDealId } from "@/lib/deals-pure";

export const dynamic = "force-dynamic";

// MARKETS → Deals: the wishlist and what the hunter found (deals.ts, local file). Read-only on the web; nothing is bought or sent.
// GET: the board. POST {action:"add", item, maxPrice, ...} | {action:"remove"|"done", id} | {action:"dismiss", id, offer} | {action:"hunt"} (poll GET while busy).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await dealBoard()); } catch (e) { return fail(e instanceof Error ? e.message : "Couldn't read the wishlist", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/markets/deals", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "add") {
    const w = await addWishItem(sb, user.id, b);
    return typeof w === "string" ? fail(w) : Response.json({ wish: w });
  }
  if (b.action === "hunt") {
    // A hunt takes minutes: answer now, the card polls GET until busy clears.
    const started = huntDeals(sb, user.id, "foreground", { all: true });
    const early = await Promise.race([started.then(() => null, (e: Error) => e.message), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
    if (early) return fail(`Not hunting: ${early}`, 503);
    started.catch(() => {}); // its error is saved as lastError for the board
    return Response.json({ started: true }, { status: 202 });
  }
  if (!isDealId(b.id)) return fail("id required");
  switch (b.action) {
    case "remove":
    case "done":
      return (await closeWish(sb, user.id, b.id, b.action === "done" ? "done" : "removed")) ? Response.json({ ok: true }) : fail("Not found", 404);
    case "dismiss":
      return typeof b.offer === "string" && /^o[0-9a-f]{8}$/.test(b.offer) && (await dismissOffer(b.id, b.offer)) ? Response.json({ ok: true }) : fail("Not found", 404);
    default: return fail("action must be add, hunt, remove, done or dismiss");
  }
}
